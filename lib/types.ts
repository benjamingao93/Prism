import { z } from "zod";

export const QUERY_LANGUAGES = ["en", "zh", "es", "ja", "pt"] as const;
export type QueryLanguage = (typeof QUERY_LANGUAGES)[number];

/** Publication-language filter options (ISO 639-1, as reported by OpenAlex). */
export const PUBLICATION_LANGUAGES = ["en", "zh", "es", "ja", "pt", "fr", "de", "ko", "ru"] as const;

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
    perVariant: z.number().int().min(5).max(50).default(25),
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
  /** ISO 639-1 publication language from source metadata, or null if unavailable. */
  language: string | null;
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
  /** Keyword-form string actually sent to the search API. */
  searchQuery: string;
  source: PaperSource;
  /** True when the strict query returned too few hits and a relaxed OR query was used. */
  relaxed: boolean;
  hitCount: number;
  totalAvailable: number | null;
  error: string | null;
  skipped: string | null;
}

export interface ScoreBreakdown {
  /** Raw cosine similarity between the query and paper text embeddings, or null if unavailable. */
  semanticRaw: number | null;
  /** Min-max normalized semantic score within this result set. */
  semantic: number | null;
  /** Raw BM25 score (max over query variants). */
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

export type EmbeddingStatus = "disabled" | "idle" | "loading" | "ready" | "failed";

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
    perVariant: number;
  };
  variants: QueryVariant[];
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
