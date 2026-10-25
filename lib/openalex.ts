import { fetchJson, type FetchJsonOptions } from "./http";
import { toPlainText } from "./text";
import type { Paper } from "./types";
import { normalizeDoi, safeExternalUrl } from "./url";

const BASE_URL = "https://api.openalex.org/works";

const SELECT_FIELDS = [
  "id",
  "doi",
  "title",
  "display_name",
  "authorships",
  "publication_year",
  "primary_location",
  "best_oa_location",
  "open_access",
  "abstract_inverted_index",
  "language",
  "cited_by_count",
  "type",
].join(",");

/** Subset of the OpenAlex Work object that we request. Every field may be missing or null. */
export interface OpenAlexWork {
  id?: string | null;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null } | null> | null;
  publication_year?: number | null;
  primary_location?: OpenAlexLocation | null;
  best_oa_location?: OpenAlexLocation | null;
  open_access?: { is_oa?: boolean | null; oa_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  language?: string | null;
  cited_by_count?: number | null;
  type?: string | null;
}

interface OpenAlexLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  source?: { id?: string | null; display_name?: string | null } | null;
}

function sourceIdOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.split("/").pop() ?? "";
  return /^S\d+$/.test(id) ? id : null;
}

export interface OpenAlexListResponse {
  meta?: { count?: number | null } | null;
  results?: OpenAlexWork[] | null;
}

/** Rebuild abstract text from OpenAlex's inverted index ({word: [positions]}). */
export function reconstructAbstract(index: OpenAlexWork["abstract_inverted_index"]): string | null {
  if (!index || typeof index !== "object") return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0 && pos < 20_000) words[pos] = word;
    }
  }
  const joined = words.filter((w) => w !== undefined).join(" ");
  return toPlainText(joined);
}

function normalizeLanguage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(code) ? code : null;
}

export function normalizeOpenAlexWork(work: OpenAlexWork): Paper | null {
  const openalexId = typeof work.id === "string" && work.id.startsWith("https://openalex.org/") ? work.id : null;
  const doi = normalizeDoi(work.doi);
  if (!openalexId && !doi) return null;

  const authorNames = (Array.isArray(work.authorships) ? work.authorships : [])
    .map((a) => toPlainText(a?.author?.display_name))
    .filter((n): n is string => Boolean(n));

  const year =
    typeof work.publication_year === "number" && work.publication_year > 1500 && work.publication_year < 2200
      ? work.publication_year
      : null;

  const primary = work.primary_location ?? null;
  const oaUrl =
    safeExternalUrl(work.open_access?.oa_url) ??
    safeExternalUrl(work.best_oa_location?.pdf_url) ??
    safeExternalUrl(work.best_oa_location?.landing_page_url);

  return {
    id: openalexId ?? `doi:${doi}`,
    openalexId,
    doi,
    title: toPlainText(work.title ?? work.display_name),
    authors: authorNames,
    authorCount: authorNames.length,
    year,
    venue: toPlainText(primary?.source?.display_name),
    abstract: reconstructAbstract(work.abstract_inverted_index),
    language: normalizeLanguage(work.language),
    languageTag: normalizeLanguage(work.language),
    languageSource: "metadata",
    sourceId: sourceIdOf(primary?.source?.id),
    country: null,
    landingUrl: safeExternalUrl(primary?.landing_page_url) ?? (doi ? `https://doi.org/${doi}` : null),
    oaUrl,
    isOpenAccess: typeof work.open_access?.is_oa === "boolean" ? work.open_access.is_oa : null,
    citedByCount: typeof work.cited_by_count === "number" ? work.cited_by_count : null,
    type: typeof work.type === "string" ? work.type : null,
    sources: ["openalex"],
    retrievedBy: [],
  };
}

export interface OpenAlexSearchParams {
  search: string;
  languages: string[];
  yearFrom: number | null;
  yearTo: number | null;
  perPage: number;
  /** 1-based results page (OpenAlex basic paging). */
  page?: number;
}

export interface OpenAlexConfig {
  apiKey: string | null;
  mailto: string | null;
}

export function buildOpenAlexUrl(params: OpenAlexSearchParams, config: OpenAlexConfig): string {
  const url = new URL(BASE_URL);
  url.searchParams.set("search.title_and_abstract", params.search);
  const filters: string[] = [];
  if (params.languages.length) filters.push(`language:${params.languages.join("|")}`);
  if (params.yearFrom != null) filters.push(`from_publication_date:${params.yearFrom}-01-01`);
  if (params.yearTo != null) filters.push(`to_publication_date:${params.yearTo}-12-31`);
  if (filters.length) url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("per_page", String(Math.min(Math.max(params.perPage, 1), 100)));
  if (params.page && params.page > 1) url.searchParams.set("page", String(params.page));
  url.searchParams.set("select", SELECT_FIELDS);
  if (config.mailto) url.searchParams.set("mailto", config.mailto);
  if (config.apiKey) url.searchParams.set("api_key", config.apiKey);
  return url.toString();
}

export interface SearchResult {
  papers: Paper[];
  total: number | null;
}

export async function searchOpenAlex(
  params: OpenAlexSearchParams,
  config: OpenAlexConfig,
  fetchOpts: Partial<FetchJsonOptions> = {},
): Promise<SearchResult> {
  const data = await fetchJson<OpenAlexListResponse>(buildOpenAlexUrl(params, config), {
    service: "OpenAlex",
    timeoutMs: 15_000,
    retries: 2,
    ...fetchOpts,
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  const papers = results.map(normalizeOpenAlexWork).filter((p): p is Paper => p !== null);
  return { papers, total: typeof data?.meta?.count === "number" ? data.meta.count : null };
}

interface GroupByResponse {
  group_by?: Array<{ key?: string | null; count?: number | null }> | null;
}

/**
 * Count works per language matching `search` in a single request (group_by=language). Used to
 * estimate how large each language's literature on the topic is.
 */
export async function countWorksByLanguage(
  params: { search: string; yearFrom: number | null; yearTo: number | null },
  config: OpenAlexConfig,
  fetchOpts: Partial<FetchJsonOptions> = {},
): Promise<Record<string, number>> {
  const url = new URL(BASE_URL);
  url.searchParams.set("search.title_and_abstract", params.search);
  const filters: string[] = [];
  if (params.yearFrom != null) filters.push(`from_publication_date:${params.yearFrom}-01-01`);
  if (params.yearTo != null) filters.push(`to_publication_date:${params.yearTo}-12-31`);
  if (filters.length) url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("group_by", "language");
  if (config.mailto) url.searchParams.set("mailto", config.mailto);
  if (config.apiKey) url.searchParams.set("api_key", config.apiKey);
  const data = await fetchJson<GroupByResponse>(url.toString(), { service: "OpenAlex", timeoutMs: 15_000, retries: 1, ...fetchOpts });
  const out: Record<string, number> = {};
  for (const g of Array.isArray(data?.group_by) ? data.group_by : []) {
    const code = typeof g?.key === "string" ? g.key.split("/").pop()!.toLowerCase() : null;
    // OpenAlex can return more than one group key for the same language (e.g. differing case or
    // form), so counts are summed rather than overwritten.
    if (code && /^[a-z]{2,3}$/.test(code) && typeof g.count === "number") out[code] = (out[code] ?? 0) + g.count;
  }
  return out;
}

/**
 * OR terms together for OpenAlex boolean search, each quoted as an exact phrase. Quoting keeps
 * languages comparable: unquoted, OpenAlex matches multi-character Chinese/Japanese terms loosely
 * (农业适应 matched 5,366 Chinese works unquoted vs 6 as a phrase), inflating CJK counts.
 */
export function orQuery(terms: string[]): string {
  const cleaned = [...new Set(terms.map((t) => t.replace(/["“”()]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean))];
  return cleaned.map((t) => `"${t}"`).join(" OR ");
}

interface SourcesResponse {
  results?: Array<{ id?: string | null; country_code?: string | null } | null> | null;
}

/**
 * Look up the country of publication venues, 100 per request (a cheap list call). Returns a map
 * from source ID to ISO alpha-2 code, or null where OpenAlex records no country.
 */
export async function fetchSourceCountries(
  ids: string[],
  config: OpenAlexConfig,
  fetchOpts: Partial<FetchJsonOptions> = {},
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id) => /^S\d+$/.test(id)))];
  const out = new Map<string, string | null>(unique.map((id) => [id, null]));
  for (let i = 0; i < unique.length; i += 100) {
    const url = new URL("https://api.openalex.org/sources");
    url.searchParams.set("filter", `openalex:${unique.slice(i, i + 100).join("|")}`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("select", "id,country_code");
    if (config.mailto) url.searchParams.set("mailto", config.mailto);
    if (config.apiKey) url.searchParams.set("api_key", config.apiKey);
    const data = await fetchJson<SourcesResponse>(url.toString(), { service: "OpenAlex", timeoutMs: 15_000, retries: 1, ...fetchOpts });
    for (const s of Array.isArray(data?.results) ? data.results : []) {
      const id = sourceIdOf(s?.id);
      const cc = typeof s?.country_code === "string" ? s.country_code.trim().toUpperCase() : "";
      if (id) out.set(id, /^[A-Z]{2}$/.test(cc) ? cc : null);
    }
  }
  return out;
}
