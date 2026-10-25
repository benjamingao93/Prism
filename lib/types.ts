import { z } from "zod";

/**
 * Languages Prism can search in (and accept questions in), ISO 639-1. Chosen from the
 * largest abstract-bearing literatures in OpenAlex that the multilingual embedding model supports.
 * Each one adds an OpenAlex request per search.
 */
export const QUERY_LANGUAGES = [
  "en", "zh", "es", "pt", "fr", "de", "ja", "ru", "ko", "id", "it", "tr", "pl", "uk", "ar", "hi", "af", "sw",
] as const;
export type QueryLanguage = (typeof QUERY_LANGUAGES)[number];

/** Publication-language filter options: the same set, as reported by OpenAlex metadata. */
export const PUBLICATION_LANGUAGES = QUERY_LANGUAGES;

/** How many top-ranked papers to return, across all languages combined. */
export const RESULT_LIMITS = [25, 50, 100] as const;
/** "Load more" fetches at most this many pages (1,000 results at the default page size). */
export const MAX_PAGES = 10;

/** Number of results a response holds for each ranking mode: page size × pages loaded. */
export function resultCount(filters: { limit: number; pages: number }): number {
  return filters.limit * filters.pages;
}


export const RANKING_MODES = ["hybrid", "semantic", "keyword"] as const;
export type RankingMode = (typeof RANKING_MODES)[number];

export const SearchRequestSchema = z
  .object({
    query: z.string().trim().min(2, "Query is too short").max(500, "Query is too long"),
    queryLanguage: z.enum(QUERY_LANGUAGES).default("en"),
    /** Languages to translate the query into. Defaults to every supported query language except the query's own. */
    expandTo: z.array(z.enum(QUERY_LANGUAGES)).max(QUERY_LANGUAGES.length).optional(),
    /** Restrict retrieval to these publication languages. Empty or omitted = all languages. */
    publicationLanguages: z.array(z.string().regex(/^[a-z]{2}$/)).max(20).default([]),
    yearFrom: z.number().int().min(1800).max(2100).nullable().default(null),
    yearTo: z.number().int().min(1800).max(2100).nullable().default(null),
    mode: z.enum(RANKING_MODES).default("hybrid"),
    /**
     * Top-N papers returned overall, ranked across all languages. Each language may also supply
     * up to N candidates, so no language is capped below what it would take to fill the list.
     */
    limit: z.number().int().min(5).max(100).default(100),
    /**
     * How many pages deep to search ("Load more"). Each page adds up to `limit` candidates per
     * language and `limit` more results; earlier pages come from the server cache.
     */
    pages: z.number().int().min(1).max(10).default(1),
  })
  .refine((r) => r.yearFrom == null || r.yearTo == null || r.yearFrom <= r.yearTo, {
    message: "Start year must be before end year",
    path: ["yearFrom"],
  });

export type SearchRequest = z.output<typeof SearchRequestSchema>;
export type SearchRequestInput = z.input<typeof SearchRequestSchema>;

export type PaperSource = "openalex" | "crossref";

/** One retrieval of a paper by one query variant. */
export interface Retrieval {
  variantId: string;
  /** 1-based rank in that variant's source response. */
  rank: number;
}

/** Normalized scholarly record. Missing values are null — never invented. */
export interface Paper {
  /** Stable key within a result set (OpenAlex ID, else `doi:<doi>`). */
  id: string;
  openalexId: string | null;
  doi: string | null;
  title: string | null;
  authors: string[];
  authorCount: number;
  year: number | null;
  venue: string | null;
  abstract: string | null;
  /**
   * ISO 639-1 language of the paper: the source's tag, unless the title/abstract text was checked
   * and found to be in a different language (see `languageSource`). Null if unavailable.
   */
  language: string | null;
  /** The language tag exactly as the source reported it. */
  languageTag: string | null;
  /** "metadata": `language` is the source tag. "detected": Gemini found the text is in another language. */
  languageSource: "metadata" | "detected";
  /** OpenAlex ID of the venue (journal, repository, …) it was published in, e.g. "S4210172589". */
  sourceId: string | null;
  /**
   * ISO 3166-1 alpha-2 country of the publication venue, as recorded by OpenAlex (for journals
   * of large international publishers this is often the publisher's registered country). Null if
   * unknown. Never derived from authors or language.
   */
  country: string | null;
  landingUrl: string | null;
  oaUrl: string | null;
  isOpenAccess: boolean | null;
  citedByCount: number | null;
  type: string | null;
  sources: PaperSource[];
  retrievedBy: Retrieval[];
}

export interface QueryVariant {
  id: string;
  lang: string;
  kind: "original" | "translated";
  /** Natural-language text: the user's query, or its machine translation. */
  text: string;
  /** Keyword-form string actually sent to the search API (may be a broadened subset of `concepts`). */
  searchQuery: string;
  /** All core concepts for this language, most essential first. Keyword scoring uses all of them. */
  concepts: string[];
  source: PaperSource;
  /** True when the strict query returned too few hits and a relaxed OR query was used. */
  relaxed: boolean;
  /** Candidates retrieved for this variant. */
  hitCount: number;
  totalAvailable: number | null;
  /** Distinctive subject term used to size this language's literature. */
  topic: string;
  /**
   * Estimated size of this language's literature on the topic: OpenAlex works in this language
   * matching any language's topic term. Drives proportional candidate allocation.
   */
  matchCount: number | null;
  /** Candidates kept for ranking after proportional allocation. */
  kept: number;
  /** True when the last page fetched for this variant was full, so deeper pages may exist. */
  hasMore: boolean;
  error: string | null;
  skipped: string | null;
}

export interface ScoreBreakdown {
  /** Raw cosine similarity between the query and paper text embeddings, or null if unavailable. */
  semanticRaw: number | null;
  /** Min-max normalized semantic score within this result set. */
  semantic: number | null;
  /** BM25 as a share of an ideal match to the best query variant (0–1, comparable across languages). */
  keywordRaw: number;
  /** Min-max normalized BM25 score within this result set. */
  keyword: number;
  /** 0.7 · semantic + 0.3 · keyword (normalized), or null without embeddings. */
  hybrid: number | null;
  matchedTerms: string[];
}

export type ExplanationKind = "semantic" | "terms" | "translated" | "multi" | "title-only";

export interface Explanation {
  kind: ExplanationKind;
  text: string;
}

export interface RankedPaper extends Paper {
  scores: ScoreBreakdown;
  explanations: Explanation[];
  textUsed: "title+abstract" | "title" | "none";
}

/**
 * "on-demand": serverless (Vercel), where each function instance loads the model when a search
 * first needs it, so this process's state says nothing about the one that will run the search.
 */
export type EmbeddingStatus = "disabled" | "idle" | "loading" | "ready" | "failed" | "on-demand";

export interface Capabilities {
  llm: boolean;
  embeddings: EmbeddingStatus;
  embeddingModel: string | null;
  openalexKey: boolean;
  crossref: boolean;
}

export interface SearchResponse {
  query: string;
  queryLanguage: QueryLanguage;
  requestedMode: RankingMode;
  effectiveMode: RankingMode;
  availableModes: RankingMode[];
  filters: {
    publicationLanguages: string[];
    yearFrom: number | null;
    yearTo: number | null;
    limit: number;
    pages: number;
  };
  /** True when a deeper page could add results (some language has more matches to fetch). */
  canLoadMore: boolean;
  variants: QueryVariant[];
  /** Unique candidates ranked (after allocation and deduplication), before taking the top `limit`. */
  candidateCount: number;
  /** Candidates retrieved across all variants, before proportional allocation. */
  retrievedCount: number;
  /** Where the literature-size estimate came from. */
  literatureEstimate: "topic" | "overall";
  /**
   * The top `limit` papers under every available ranking mode (their union), plus the
   * original-query baseline's top papers, so switching modes client-side stays exact.
   * Sort by a mode and take the first `resultCount(filters)` to get that mode's results.
   */
  papers: RankedPaper[];
  capabilities: Capabilities;
  notices: string[];
  weights: { semantic: number; keyword: number };
  tookMs: number;
}

export interface ApiError {
  error: string;
  code: "invalid_request" | "rate_limited" | "upstream_unavailable" | "timeout" | "internal" | "llm_unavailable";
  details?: string[];
}

export const TranslateRequestSchema = z.object({
  targetLang: z.enum(QUERY_LANGUAGES),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        title: z.string().max(1000).nullable(),
        abstract: z.string().max(12000).nullable().optional(),
      }),
    )
    .min(1)
    .max(30),
});
export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

export interface TranslatedItem {
  id: string;
  title: string | null;
  abstract: string | null;
  /** The source text was already in the target language, so nothing was translated. */
  titleAlreadyInTarget: boolean;
  abstractAlreadyInTarget: boolean;
}

export interface TranslateResponse {
  targetLang: QueryLanguage;
  model: string;
  items: TranslatedItem[];
}

export const SummarizeRequestSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(1000).nullable(),
  abstract: z.string().min(40, "Abstract too short to summarize").max(12000),
  targetLang: z.enum(QUERY_LANGUAGES).default("en"),
});

export interface PaperSummary {
  researchQuestion: string;
  methodology: string;
  mainFinding: string;
  limitations: string;
}

export interface SummarizeResponse {
  id: string;
  model: string;
  summary: PaperSummary;
}
