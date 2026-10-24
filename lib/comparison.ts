import { sortByMode } from "./ranking";
import type { QueryVariant, RankedPaper, RankingMode } from "./types";

export interface Comparison {
  /** Top-K size used for both lists. */
  k: number;
  baselineVariant: QueryVariant | null;
  baselinePoolSize: number;
  multilingualPoolSize: number;
  baselineTop: RankedPaper[];
  multilingualTop: RankedPaper[];
  /** |baselineTop ∩ multilingualTop| / k */
  overlap: number;
  /** Papers in the multilingual top-K that the original-language query did not retrieve at all. */
  additional: RankedPaper[];
}

/**
 * Compare the original-language-only search (the original query variant, same filters and page
 * size) against the full multilingual result pool. Both lists are ranked with the same scores.
 */
export function compareBaseline(
  papers: RankedPaper[],
  variants: QueryVariant[],
  mode: RankingMode,
  k = 10,
): Comparison {
  const baselineVariant = variants.find((v) => v.kind === "original" && v.source === "openalex") ?? null;
  const baselinePool = baselineVariant
    ? papers.filter((p) => p.retrievedBy.some((r) => r.variantId === baselineVariant.id))
    : [];
  const size = Math.min(k, papers.length);
  const baselineTop = sortByMode(baselinePool, mode).slice(0, size);
  const multilingualTop = sortByMode(papers, mode).slice(0, size);
  const baselineTopIds = new Set(baselineTop.map((p) => p.id));
  const baselinePoolIds = new Set(baselinePool.map((p) => p.id));
  const shared = multilingualTop.filter((p) => baselineTopIds.has(p.id)).length;

  return {
    k: size,
    baselineVariant,
    baselinePoolSize: baselinePool.length,
    multilingualPoolSize: papers.length,
    baselineTop,
    multilingualTop,
    overlap: size ? shared / size : 0,
    additional: multilingualTop.filter((p) => !baselinePoolIds.has(p.id)),
  };
}

export interface Coverage {
  uniquePapers: number;
  languages: { code: string | null; count: number }[];
  languageCount: number;
  unknownLanguage: number;
  viaTranslatedOnly: number;
  viaTranslatedAny: number;
  withAbstract: number;
}

export function computeCoverage(papers: RankedPaper[], variants: QueryVariant[]): Coverage {
  const translatedIds = new Set(variants.filter((v) => v.kind === "translated").map((v) => v.id));
  const counts = new Map<string | null, number>();
  let viaTranslatedOnly = 0;
  let viaTranslatedAny = 0;
  let withAbstract = 0;
  for (const p of papers) {
    counts.set(p.language, (counts.get(p.language) ?? 0) + 1);
    const t = p.retrievedBy.filter((r) => translatedIds.has(r.variantId)).length;
    if (t > 0) viaTranslatedAny++;
    if (t > 0 && t === p.retrievedBy.length) viaTranslatedOnly++;
    if (p.abstract) withAbstract++;
  }
  const languages = [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || (a.code ?? "zz").localeCompare(b.code ?? "zz"));
  return {
    uniquePapers: papers.length,
    languages,
    languageCount: languages.filter((l) => l.code !== null).length,
    unknownLanguage: counts.get(null) ?? 0,
    viaTranslatedOnly,
    viaTranslatedAny,
    withAbstract,
  };
}
