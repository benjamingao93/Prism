import { mergePapers } from "./deduplication";
import { filterPapers } from "./filters";
import {
  assembleThemes,
  buildGapsPrompt,
  buildOverviewPrompt,
  computeHighlights,
  defaultBaseline,
  dropOffTopic,
  gapsSystemPrompt,
  overviewSystemPrompt,
  sampleByLanguage,
  type GapPaper,
  type GapsRequest,
  type GapsResponse,
  type GapThemesOutput,
} from "./gaps";
import { UpstreamError } from "./http";
import { applyLanguageOverrides, languageCheckText, needsLanguageCheck } from "./language-check";
import { languageName } from "./languages";
import type { SearchDeps } from "./search";
import type { Paper } from "./types";
import { doiUrl, safeExternalUrl } from "./url";

export interface GapDeps extends Pick<SearchDeps, "searchOpenAlex" | "checkLanguages" | "semantic"> {
  /** One structured LLM call naming the themes, tagging each paper with them, and flagging off-topic papers. */
  themes: (system: string, prompt: string) => Promise<{ data: GapThemesOutput; model: string }>;
  /** A short summary written from the computed differences; null to skip. */
  overview: ((system: string, prompt: string) => Promise<string>) | null;
}

export class GapAnalysisError extends Error {
  constructor(
    readonly code: "rate_limited" | "upstream_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "GapAnalysisError";
  }
}

/** OpenAlex's top matches per language that go on to relevance ranking before sampling. */
const POOL_PER_LANGUAGE = 40;

function bestRank(p: Paper): number {
  return Math.min(...p.retrievedBy.map((r) => r.rank), Number.POSITIVE_INFINITY);
}

function toGapPaper(p: Paper): GapPaper {
  return {
    id: p.id,
    title: p.title,
    language: p.language!,
    year: p.year,
    venue: p.venue,
    url: safeExternalUrl(p.landingUrl) ?? (p.doi ? doiUrl(p.doi) : null),
  };
}

/**
 * Sample each language's most relevant papers for the search's question, then have the LLM name
 * the themes they discuss and tag each paper. The search's own queries are re-run with the same
 * parameters, so OpenAlex responses come from its cache.
 */
export async function runGapAnalysis(req: GapsRequest, deps: GapDeps): Promise<GapsResponse> {
  const started = Date.now();
  const notices: string[] = [];

  // 1. Every language's matches, independent of how many the search kept for ranking.
  const failed: string[] = [];
  const errors: unknown[] = [];
  const lists = await Promise.all(
    req.variants.map(async (v, i): Promise<Paper[]> => {
      const languages = v.kind === "original" ? req.publicationLanguages : [v.lang];
      const base = { languages, yearFrom: req.yearFrom, yearTo: req.yearTo, perPage: req.limit };
      try {
        const result = await deps.searchOpenAlex({ ...base, search: v.searchQuery });
        return result.papers.map((p, idx) => ({ ...p, retrievedBy: [{ variantId: `gaps:${v.lang}:${i}`, rank: idx + 1 }] }));
      } catch (err) {
        errors.push(err);
        failed.push(v.lang);
        return [];
      }
    }),
  );
  if (failed.length === req.variants.length) {
    const rateLimited = errors.some((e) => e instanceof UpstreamError && e.kind === "rate_limited");
    throw new GapAnalysisError(
      rateLimited ? "rate_limited" : "upstream_unavailable",
      rateLimited
        ? "OpenAlex rate limit or daily budget reached, so papers could not be gathered. Try again later."
        : "OpenAlex is currently unavailable. Please try again shortly.",
    );
  }
  if (failed.length) {
    notices.push(`Papers could not be retrieved for: ${[...new Set(failed)].map((l) => languageName(l)).join(", ")}.`);
  }

  // 2. Merge, correct language tags the text contradicts, and apply the search's filters.
  let pool = mergePapers(lists);
  const flagged = deps.checkLanguages ? pool.filter(needsLanguageCheck) : [];
  if (flagged.length) {
    try {
      const detected = await deps.checkLanguages!(flagged.map((p) => ({ id: p.id, text: languageCheckText(p)! })));
      pool = applyLanguageOverrides(pool, detected);
    } catch {
      notices.push("The language check could not run; languages are as tagged by OpenAlex.");
    }
  }
  pool = filterPapers(pool, { languages: req.publicationLanguages, yearFrom: req.yearFrom, yearTo: req.yearTo });

  // 3. Rank each language's leading matches by meaning, then sample the best of each.
  const perLanguage = new Map<string, Paper[]>();
  for (const p of [...pool].sort((a, b) => bestRank(a) - bestRank(b))) {
    if (!p.language) continue;
    const list = perLanguage.get(p.language) ?? [];
    if (list.length < POOL_PER_LANGUAGE) list.push(p);
    perLanguage.set(p.language, list);
  }
  const candidates = [...perLanguage.values()].flat();
  const queryTexts = [...new Set(req.variants.map((v) => v.text).filter(Boolean))];
  const semantic = candidates.length ? await deps.semantic(queryTexts, candidates, "full") : { scores: null, notice: null };
  if (semantic.notice) notices.push(semantic.notice);
  const sampled = sampleByLanguage(candidates, semantic.scores);
  const tooFew = "At least two languages need three or more relevant papers to compare; this search doesn't have enough.";
  const summary = (groups: Map<string, Paper[]>) =>
    [...groups.entries()].map(([code, papers]) => ({ code, total: papers.length })).sort((a, b) => b.total - a.total);
  if (sampled.groups.size < 2) {
    notices.push(tooFew);
    return {
      query: req.query,
      queryLanguage: req.queryLanguage,
      model: null,
      languages: summary(sampled.groups),
      excluded: sampled.excluded,
      offTopic: [],
      themes: [],
      papers: [],
      overview: null,
      notices,
      tookMs: Date.now() - started,
    };
  }

  // 4. Themes, tags and off-topic flags from the LLM. Shares are computed from the tags, never
  // taken from the model, and off-topic papers count toward nothing.
  const { prompt, ids } = buildGapsPrompt(req.query, sampled.groups);
  const { data, model } = await deps.themes(gapsSystemPrompt(req.queryLanguage), prompt);
  const kept = dropOffTopic(sampled.groups, ids, data.off_topic);
  const languages = summary(kept.groups);
  const excluded = [...sampled.excluded, ...kept.excluded].sort((a, b) => b.total - a.total);
  const themes = kept.groups.size >= 2 ? assembleThemes(data, ids, kept.groups) : [];
  if (kept.groups.size < 2) notices.push(tooFew);

  // 5. A short summary written from the computed differences, so it can't contradict them.
  let overview: string | null = null;
  const baseline = defaultBaseline(languages);
  const highlights = baseline ? computeHighlights({ languages, themes }, baseline) : [];
  if (deps.overview && baseline && highlights.length) {
    try {
      overview = (await deps.overview(overviewSystemPrompt(req.queryLanguage), buildOverviewPrompt(req.query, highlights, baseline))).trim() || null;
    } catch {
      // The comparisons stand on their own; the summary is optional.
    }
  }

  return {
    query: req.query,
    queryLanguage: req.queryLanguage,
    model,
    languages,
    excluded,
    offTopic: kept.offTopic,
    themes,
    papers: [...kept.groups.values()].flat().map(toGapPaper),
    overview,
    notices,
    tookMs: Date.now() - started,
  };
}
