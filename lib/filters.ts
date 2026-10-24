import { scoreFor } from "./ranking";
import type { Paper, RankedPaper, RankingMode } from "./types";

export interface ResultFilters {
  /** Empty = all languages. "unknown" matches papers without language metadata. */
  languages: string[];
  yearFrom: number | null;
  yearTo: number | null;
}

export function matchesFilters(p: Paper, f: ResultFilters): boolean {
  if (f.languages.length) {
    const lang = p.language ?? "unknown";
    if (!f.languages.includes(lang)) return false;
  }
  if (f.yearFrom != null && (p.year == null || p.year < f.yearFrom)) return false;
  if (f.yearTo != null && (p.year == null || p.year > f.yearTo)) return false;
  return true;
}

export function filterPapers<T extends Paper>(papers: T[], f: ResultFilters): T[] {
  return papers.filter((p) => matchesFilters(p, f));
}

/** Drop results below a minimum score for the active ranking mode. */
export function filterByMinScore(papers: RankedPaper[], mode: RankingMode, min: number): RankedPaper[] {
  if (min <= 0) return papers;
  return papers.filter((p) => (scoreFor(p, mode) ?? 0) >= min);
}
