import type { CrossrefSearchParams } from "./crossref";
import { mergePapers } from "./deduplication";
import { filterPapers } from "./filters";
import { UpstreamError } from "./http";
import { languageName } from "./languages";
import type { OpenAlexSearchParams, SearchResult } from "./openalex";
import type { ExpansionResult } from "./query-expansion";
import { availableModes, HYBRID_WEIGHTS, keywordScores, resolveMode, scorePapers, selectTopResults } from "./ranking";
import type { Capabilities, Paper, QueryLanguage, QueryVariant, SearchRequest, SearchResponse } from "./types";
import { QUERY_LANGUAGES } from "./types";

export type SearchOpenAlexFn = (params: OpenAlexSearchParams) => Promise<SearchResult>;
export type SearchCrossrefFn = (params: CrossrefSearchParams) => Promise<SearchResult>;

export interface SearchDeps {
  expand: (query: string, source: QueryLanguage, targets: QueryLanguage[]) => Promise<ExpansionResult>;
  searchOpenAlex: SearchOpenAlexFn;
  searchCrossref: SearchCrossrefFn | null;
  /**
   * Cosine similarity per paper id against the question (given as the original text plus its
   * translations), using each paper's title only or title + abstract. Null when semantic ranking
   * is unavailable (with reason).
   */
  semantic: (
    queryTexts: string[],
    papers: Paper[],
    field: "title" | "full",
  ) => Promise<{ scores: Map<string, number> | null; notice: string | null }>;
  capabilities: () => Capabilities;
}

export class SearchFailedError extends Error {
  constructor(
    readonly code: "rate_limited" | "timeout" | "upstream_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SearchFailedError";
  }
}

/** Size of the top-k lists in the original-language vs multilingual comparison. */
export const COMPARISON_K = 10;

/**
 * Stage-1 shortlist size as a multiple of the result limit. Title-only scores are a rougher
 * signal than title + abstract, so the shortlist keeps a generous margin.
 */
export const SHORTLIST_FACTOR = 3;

/** Minimum hits before a sparse query is broadened. */
export const RELAX_THRESHOLD = 5;

/**
 * Broader fallbacks for a sparse query, tried in order (at most two extra requests). Concepts are
 * ordered most-essential first, so we keep the leading two concepts, then only the first. Whole
 * concepts are dropped, never words within one ("contaminación del aire" stays intact). Broadening
 * only widens the candidate net: keyword scoring still uses every concept, so a paper matching
 * just the broad terms scores like an English paper that matches just those terms.
 */
export function relaxedQueries(concepts: string[]): string[] {
  const ladder = [concepts.slice(0, 2), concepts.slice(0, 1)]
    .filter((c) => c.length && c.length < concepts.length)
    .map((c) => c.join(" "));
  return [...new Set(ladder)];
}

function describeError(err: unknown): string {
  if (err instanceof UpstreamError) return err.message;
  return "Request failed";
}

export async function runSearch(req: SearchRequest, deps: SearchDeps): Promise<SearchResponse> {
  const started = Date.now();
  const notices: string[] = [];
  const targets = (req.expandTo ?? QUERY_LANGUAGES.filter((l) => l !== req.queryLanguage)).filter(
    (l) => l !== req.queryLanguage,
  );

  // 1. Expand the query across languages.
  const expansion = await deps.expand(req.query, req.queryLanguage, targets);
  if (expansion.notice) notices.push(expansion.notice);
  if (expansion.variants.some((v) => v.kind === "translated")) {
    notices.push("Translated queries are machine-generated; technical meaning can shift between languages.");
  }

  const pubLangs = req.publicationLanguages;
  const variants: QueryVariant[] = expansion.variants.map((v, i) => ({
    id: `openalex:${v.lang}:${i}`,
    lang: v.lang,
    kind: v.kind,
    text: v.text,
    searchQuery: v.concepts.join(" "),
    concepts: v.concepts,
    source: "openalex",
    relaxed: false,
    hitCount: 0,
    totalAvailable: null,
    error: null,
    skipped:
      v.kind === "translated" && pubLangs.length && !pubLangs.includes(v.lang)
        ? `Skipped: ${languageName(v.lang)} is excluded by the publication-language filter`
        : null,
  }));

  // 2. Retrieve from OpenAlex, one request per variant (plus one broader retry if too few hits).
  const errors: unknown[] = [];
  const lists = await Promise.all(
    variants.map(async (variant): Promise<Paper[]> => {
      if (variant.skipped) return [];
      // Original query: user's publication-language filter. Translated query: its own language.
      const languages = variant.kind === "original" ? pubLangs : [variant.lang];
      // Every language may supply as many candidates as the result list holds, so any one
      // language could fill all of it. Ranking, not retrieval, decides the language mix.
      const base = { languages, yearFrom: req.yearFrom, yearTo: req.yearTo, perPage: req.limit };
      try {
        let result = await deps.searchOpenAlex({ ...base, search: variant.searchQuery });
        for (const broader of relaxedQueries(variant.concepts)) {
          if (result.papers.length >= RELAX_THRESHOLD) break;
          try {
            const next = await deps.searchOpenAlex({ ...base, search: broader });
            if (next.papers.length > result.papers.length) {
              result = next;
              variant.relaxed = true;
              variant.searchQuery = broader;
            }
          } catch {
            break; // Keep the best result so far.
          }
        }
        variant.hitCount = result.papers.length;
        variant.totalAvailable = result.total;
        return result.papers.map((p, idx) => ({ ...p, retrievedBy: [{ variantId: variant.id, rank: idx + 1 }] }));
      } catch (err) {
        errors.push(err);
        variant.error = describeError(err);
        return [];
      }
    }),
  );

  // 3. Optional supplementary Crossref retrieval for the original query.
  if (deps.searchCrossref) {
    const crossrefVariant: QueryVariant = {
      id: "crossref:original",
      lang: req.queryLanguage,
      kind: "original",
      text: req.query,
      searchQuery: req.query,
      concepts: [req.query],
      source: "crossref",
      relaxed: false,
      hitCount: 0,
      totalAvailable: null,
      error: null,
      skipped: null,
    };
    variants.push(crossrefVariant);
    try {
      const result = await deps.searchCrossref({
        query: req.query,
        yearFrom: req.yearFrom,
        yearTo: req.yearTo,
        rows: req.limit,
      });
      crossrefVariant.hitCount = result.papers.length;
      crossrefVariant.totalAvailable = result.total;
      lists.push(result.papers.map((p, idx) => ({ ...p, retrievedBy: [{ variantId: crossrefVariant.id, rank: idx + 1 }] })));
    } catch (err) {
      crossrefVariant.error = describeError(err);
    }
  }

  const attempted = variants.filter((v) => !v.skipped && v.source === "openalex");
  const failed = attempted.filter((v) => v.error);
  if (attempted.length && failed.length === attempted.length) {
    const rateLimited = errors.some((e) => e instanceof UpstreamError && e.kind === "rate_limited");
    const timedOut = errors.some((e) => e instanceof UpstreamError && e.kind === "timeout");
    throw new SearchFailedError(
      rateLimited ? "rate_limited" : timedOut ? "timeout" : "upstream_unavailable",
      rateLimited
        ? "OpenAlex rate limit or daily budget reached. Try again later, or configure a free OPENALEX_API_KEY."
        : timedOut
          ? "OpenAlex did not respond in time. Please try again."
          : "OpenAlex is currently unavailable. Please try again shortly.",
    );
  }
  if (failed.length) {
    notices.push(
      `Some query variants failed and were left out: ${failed.map((v) => languageName(v.lang)).join(", ")}.`,
    );
  }

  // 4. Merge, deduplicate, and enforce filters for sources that cannot filter server-side.
  const merged = filterPapers(mergePapers(lists), {
    languages: pubLangs,
    yearFrom: req.yearFrom,
    yearTo: req.yearTo,
  });

  // 5. Score in two stages. The question's meaning is represented by the original plus every
  // translation, so semantic scores don't hinge on how well the model handles one language.
  const queryTexts = [...new Set(variants.filter((v) => v.source === "openalex").map((v) => v.text))];
  const bm25 = keywordScores(merged, variants);
  const shortlistSize = SHORTLIST_FACTOR * req.limit;
  let pool = merged;
  if (merged.length > shortlistSize) {
    // Stage 1: cheap title-only semantic scores over the whole pool. Keep every paper that is in
    // the top `shortlistSize` under any mode; none of this looks at publication language.
    const titles = await deps.semantic(queryTexts, merged, "title");
    const stage1 = scorePapers({ papers: merged, variants, semantic: titles.scores, bm25 });
    const stage1Modes = availableModes(stage1, titles.scores != null);
    const keep = new Set(
      selectTopResults(stage1, stage1Modes, "hybrid", shortlistSize, { variantId: variants[0].id, k: SHORTLIST_FACTOR * COMPARISON_K }).map(
        (p) => p.id,
      ),
    );
    pool = merged.filter((p) => keep.has(p.id));
  }
  // Stage 2: full title + abstract scoring on the shortlist.
  const semantic = pool.length ? await deps.semantic(queryTexts, pool, "full") : { scores: null, notice: null };
  if (semantic.notice) notices.push(semantic.notice);
  const ranked = scorePapers({ papers: pool, variants, semantic: semantic.scores, bm25 });
  const modes = availableModes(ranked, semantic.scores != null);
  const effectiveMode = resolveMode(req.mode, modes);

  return {
    query: req.query,
    queryLanguage: req.queryLanguage,
    requestedMode: req.mode,
    effectiveMode,
    availableModes: modes,
    filters: { publicationLanguages: pubLangs, yearFrom: req.yearFrom, yearTo: req.yearTo, limit: req.limit },
    variants,
    candidateCount: merged.length,
    papers: selectTopResults(ranked, modes, effectiveMode, req.limit, {
      variantId: variants[0].id,
      k: COMPARISON_K,
    }),
    capabilities: deps.capabilities(),
    notices,
    weights: { ...HYBRID_WEIGHTS },
    tookMs: Date.now() - started,
  };
}
