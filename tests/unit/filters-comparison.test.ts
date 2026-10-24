import { describe, expect, it } from "vitest";
import { compareBaseline, computeCoverage } from "@/lib/comparison";
import { filterByMinScore, filterPapers } from "@/lib/filters";
import { scorePapers } from "@/lib/ranking";
import type { Paper, QueryVariant } from "@/lib/types";

function paper(id: string, language: string | null, year: number | null, variantIds: string[]): Paper {
  return {
    id,
    openalexId: id,
    doi: null,
    title: `rice drought ${id}`,
    authors: [],
    authorCount: 0,
    year,
    venue: null,
    abstract: null,
    language,
    landingUrl: null,
    oaUrl: null,
    isOpenAccess: null,
    citedByCount: null,
    type: null,
    sources: ["openalex"],
    retrievedBy: variantIds.map((variantId, i) => ({ variantId, rank: i + 1 })),
  };
}

const v = (id: string, lang: string, kind: "original" | "translated"): QueryVariant => ({
  id,
  lang,
  kind,
  text: "rice drought",
  searchQuery: "rice drought",
  concepts: ["rice", "drought"],
  topic: "rice",
  source: "openalex",
  relaxed: false,
  hitCount: 0,
  totalAvailable: null,
  matchCount: null,
  kept: 0,
  error: null,
  skipped: null,
});

const variants = [v("en", "en", "original"), v("zh", "zh", "translated"), v("es", "es", "translated")];
const papers = [
  paper("A", "en", 2015, ["en"]),
  paper("B", "zh", 2019, ["zh"]),
  paper("C", "en", 2021, ["en", "zh"]),
  paper("D", null, null, ["es"]),
];

describe("filterPapers", () => {
  it("filters by language, treating missing language as 'unknown'", () => {
    expect(filterPapers(papers, { languages: ["zh"], yearFrom: null, yearTo: null }).map((p) => p.id)).toEqual(["B"]);
    expect(filterPapers(papers, { languages: ["unknown"], yearFrom: null, yearTo: null }).map((p) => p.id)).toEqual(["D"]);
    expect(filterPapers(papers, { languages: [], yearFrom: null, yearTo: null })).toHaveLength(4);
  });

  it("filters by year range and excludes unknown years when a range is set", () => {
    expect(filterPapers(papers, { languages: [], yearFrom: 2016, yearTo: 2020 }).map((p) => p.id)).toEqual(["B"]);
    expect(filterPapers(papers, { languages: [], yearFrom: 2016, yearTo: null }).map((p) => p.id)).toEqual(["B", "C"]);
  });

  it("filters by minimum score for the active mode", () => {
    const ranked = scorePapers({ papers, variants, semantic: new Map([["A", 0.9], ["B", 0.3], ["C", 0.5], ["D", 0.1]]) });
    expect(filterByMinScore(ranked, "semantic", 0.45).map((p) => p.id).sort()).toEqual(["A", "C"]);
    expect(filterByMinScore(ranked, "semantic", 0)).toHaveLength(4);
  });
});

describe("computeCoverage", () => {
  it("counts languages and translated-only retrievals from real provenance", () => {
    const ranked = scorePapers({ papers, variants, semantic: null });
    const c = computeCoverage(ranked, variants);
    expect(c.uniquePapers).toBe(4);
    expect(c.languageCount).toBe(2);
    expect(c.unknownLanguage).toBe(1);
    expect(c.viaTranslatedOnly).toBe(2); // B (zh only) and D (es only); C was also found by the original query
    expect(c.viaTranslatedAny).toBe(3);
    expect(c.languages[0]).toEqual({ code: "en", count: 2 });
  });
});

describe("compareBaseline", () => {
  it("compares original-only results with the multilingual pool", () => {
    const ranked = scorePapers({ papers, variants, semantic: new Map([["A", 0.4], ["B", 0.9], ["C", 0.8], ["D", 0.2]]) });
    const cmp = compareBaseline(ranked, variants, "semantic", 2);
    expect(cmp.baselinePoolSize).toBe(2);
    expect(cmp.multilingualPoolSize).toBe(4);
    expect(cmp.baselineTop.map((p) => p.id)).toEqual(["C", "A"]);
    expect(cmp.multilingualTop.map((p) => p.id)).toEqual(["B", "C"]);
    expect(cmp.overlap).toBe(0.5);
    expect(cmp.additional.map((p) => p.id)).toEqual(["B"]);
  });
});
