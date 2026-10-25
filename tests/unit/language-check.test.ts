import { describe, expect, it, vi } from "vitest";
import { applyLanguageOverrides, languageCheckText, needsLanguageCheck } from "@/lib/language-check";
import { normalizeOpenAlexWork } from "@/lib/openalex";
import { runSearch, type SearchDeps } from "@/lib/search";
import { SearchRequestSchema, type Paper } from "@/lib/types";
import { work } from "../fixtures/openalex";

const englishAbstract = "This study examines the epidemiological characteristics of an outbreak and its transmission in cities.";
const chineseAbstract = "本研究分析了城市空气污染对儿童哮喘发病率的影响，并讨论了相关的公共卫生对策。";

function paper(n: number, overrides: Partial<Paper> = {}): Paper {
  return { ...normalizeOpenAlexWork(work({ n }))!, ...overrides };
}

describe("needsLanguageCheck", () => {
  it("flags a Chinese-tagged paper whose abstract is English", () => {
    expect(needsLanguageCheck(paper(1, { language: "zh", languageTag: "zh", abstract: englishAbstract }))).toBe(true);
  });

  it("does not flag a paper whose text matches its tag", () => {
    expect(needsLanguageCheck(paper(2, { language: "zh", languageTag: "zh", abstract: chineseAbstract }))).toBe(false);
    expect(needsLanguageCheck(paper(3, { language: "en", languageTag: "en", abstract: englishAbstract }))).toBe(false);
  });

  it("keeps the tag when the title is in the tagged language, even if the abstract is English", () => {
    // A Korean article with an English abstract, as many non-English journals publish.
    const korean = paper(9, { language: "ko", languageTag: "ko", title: "COVID-19 유행 시기의 갑상선질환 관리", abstract: englishAbstract });
    expect(needsLanguageCheck(korean)).toBe(false);
    // But a Chinese-tagged paper whose title and abstract are both English is flagged.
    expect(needsLanguageCheck(paper(11, { language: "zh", languageTag: "zh", title: "Epidemiology of an outbreak in cities", abstract: englishAbstract }))).toBe(true);
  });

  it("flags untagged papers with enough text, and skips papers with too little text", () => {
    expect(needsLanguageCheck(paper(4, { language: null, languageTag: null, abstract: chineseAbstract }))).toBe(true);
    expect(needsLanguageCheck(paper(5, { language: "zh", languageTag: "zh", abstract: null, title: "Short" }))).toBe(false);
  });

  it("accepts shorter text in CJK scripts, which carry more per character", () => {
    expect(languageCheckText(paper(8, { abstract: "水稻抗旱品种的产量研究" }))).toBe("水稻抗旱品种的产量研究");
  });

  it("judges the abstract when there is one, otherwise the title", () => {
    expect(languageCheckText(paper(6, { abstract: englishAbstract }))).toBe(englishAbstract);
    expect(languageCheckText(paper(7, { abstract: null, title: "A sufficiently long English paper title" }))).toBe(
      "A sufficiently long English paper title",
    );
  });
});

describe("applyLanguageOverrides", () => {
  const p = paper(10, { language: "zh", languageTag: "zh" });

  it("overrides only with a valid code that differs from the tag, keeping the original tag", () => {
    const [out] = applyLanguageOverrides([p], new Map([[p.id, "en"]]));
    expect(out).toMatchObject({ language: "en", languageTag: "zh", languageSource: "detected" });
  });

  it("leaves the tag alone when Gemini agrees, is unsure, or returns junk", () => {
    for (const verdict of ["zh", "unknown", "English", ""]) {
      expect(applyLanguageOverrides([p], new Map([[p.id, verdict]]))[0]).toBe(p);
    }
  });
});

describe("language check in the search pipeline", () => {
  const tagged = paper(20, { language: "zh", languageTag: "zh", abstract: englishAbstract });
  const correct = paper(21, { language: "zh", languageTag: "zh", abstract: chineseAbstract });

  function deps(checkLanguages: SearchDeps["checkLanguages"]): SearchDeps {
    return {
      expand: async () => ({ model: null, notice: null, variants: [{ lang: "en", kind: "original", text: "q", concepts: ["q"], topic: "q" }] }),
      searchOpenAlex: async () => ({ papers: [tagged, correct], total: 2 }),
      countByLanguage: null,
      checkLanguages,
      sourceCountries: null,
      searchCrossref: null,
      semantic: async (_q, papers) => ({ scores: new Map(papers.map((x) => [x.id, 0.5])), notice: null }),
      capabilities: () => ({ llm: true, embeddings: "ready", embeddingModel: "m", openalexKey: true, crossref: false }),
    };
  }

  it("sends only flagged papers to Gemini and applies its verdict", async () => {
    const check = vi.fn(async (items: { id: string; text: string }[]) => new Map(items.map((i) => [i.id, "en"])));
    const res = await runSearch(SearchRequestSchema.parse({ query: "rice", limit: 10 }), deps(check));
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0][0].map((i) => i.id)).toEqual([tagged.id]);
    expect(res.papers.find((x) => x.id === tagged.id)).toMatchObject({ language: "en", languageTag: "zh", languageSource: "detected" });
    expect(res.papers.find((x) => x.id === correct.id)).toMatchObject({ language: "zh", languageSource: "metadata" });
  });

  it("applies the publication-language filter to the corrected language", async () => {
    const check = async (items: { id: string; text: string }[]) => new Map(items.map((i) => [i.id, "en"]));
    const res = await runSearch(SearchRequestSchema.parse({ query: "rice", limit: 10, publicationLanguages: ["zh"] }), deps(check));
    expect(res.papers.map((x) => x.id)).toEqual([correct.id]);
  });

  it("keeps source tags and says so when the check fails", async () => {
    const res = await runSearch(SearchRequestSchema.parse({ query: "rice", limit: 10 }), deps(async () => Promise.reject(new Error("down"))));
    expect(res.papers.every((x) => x.languageSource === "metadata")).toBe(true);
    expect(res.notices.some((n) => n.includes("language check could not run"))).toBe(true);
  });
});
