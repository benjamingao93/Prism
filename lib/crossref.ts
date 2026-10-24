import { fetchJson, type FetchJsonOptions } from "./http";
import type { SearchResult } from "./openalex";
import { toPlainText } from "./text";
import type { Paper } from "./types";
import { doiUrl, normalizeDoi, safeExternalUrl } from "./url";

const BASE_URL = "https://api.crossref.org/works";

export interface CrossrefItem {
  DOI?: string | null;
  title?: string[] | null;
  author?: Array<{ given?: string | null; family?: string | null; name?: string | null } | null> | null;
  issued?: { "date-parts"?: Array<Array<number | null>> | null } | null;
  "container-title"?: string[] | null;
  abstract?: string | null;
  language?: string | null;
  URL?: string | null;
  type?: string | null;
  "is-referenced-by-count"?: number | null;
}

interface CrossrefResponse {
  message?: { "total-results"?: number | null; items?: CrossrefItem[] | null } | null;
}

export function normalizeCrossrefItem(item: CrossrefItem): Paper | null {
  const doi = normalizeDoi(item.DOI);
  if (!doi) return null;
  const authors = (Array.isArray(item.author) ? item.author : [])
    .map((a) => toPlainText(a?.name ?? [a?.given, a?.family].filter(Boolean).join(" ")))
    .filter((n): n is string => Boolean(n));
  const yearRaw = item.issued?.["date-parts"]?.[0]?.[0];
  const year = typeof yearRaw === "number" && yearRaw > 1500 && yearRaw < 2200 ? yearRaw : null;
  const lang = typeof item.language === "string" ? item.language.trim().toLowerCase().slice(0, 2) : null;

  return {
    id: `doi:${doi}`,
    openalexId: null,
    doi,
    title: toPlainText(item.title?.[0]),
    authors,
    authorCount: authors.length,
    year,
    venue: toPlainText(item["container-title"]?.[0]),
    abstract: toPlainText(item.abstract),
    language: lang && /^[a-z]{2}$/.test(lang) ? lang : null,
    landingUrl: safeExternalUrl(item.URL) ?? doiUrl(doi),
    oaUrl: null,
    isOpenAccess: null,
    citedByCount: typeof item["is-referenced-by-count"] === "number" ? item["is-referenced-by-count"] : null,
    type: typeof item.type === "string" ? item.type : null,
    sources: ["crossref"],
    retrievedBy: [],
  };
}

export interface CrossrefSearchParams {
  query: string;
  yearFrom: number | null;
  yearTo: number | null;
  rows: number;
}

export async function searchCrossref(
  params: CrossrefSearchParams,
  mailto: string | null,
  fetchOpts: Partial<FetchJsonOptions> = {},
): Promise<SearchResult> {
  const url = new URL(BASE_URL);
  url.searchParams.set("query.bibliographic", params.query);
  url.searchParams.set("rows", String(Math.min(params.rows, 50)));
  url.searchParams.set(
    "select",
    "DOI,title,author,issued,container-title,abstract,language,URL,type,is-referenced-by-count",
  );
  const filters: string[] = [];
  if (params.yearFrom != null) filters.push(`from-pub-date:${params.yearFrom}`);
  if (params.yearTo != null) filters.push(`until-pub-date:${params.yearTo}`);
  if (filters.length) url.searchParams.set("filter", filters.join(","));
  if (mailto) url.searchParams.set("mailto", mailto);

  const data = await fetchJson<CrossrefResponse>(url.toString(), {
    service: "Crossref",
    timeoutMs: 15_000,
    retries: 1,
    headers: mailto ? { "User-Agent": `BabelScholar/0.1 (mailto:${mailto})` } : {},
    ...fetchOpts,
  });
  const items = Array.isArray(data?.message?.items) ? data.message.items : [];
  return {
    papers: items.map(normalizeCrossrefItem).filter((p): p is Paper => p !== null),
    total: data?.message?.["total-results"] ?? null,
  };
}
