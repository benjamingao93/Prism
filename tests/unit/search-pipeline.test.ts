import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/http";
import { normalizeOpenAlexWork, type OpenAlexSearchParams, type SearchResult } from "@/lib/openalex";
import { expandQuery, planFromExpansion, type ExpansionResult } from "@/lib/query-expansion";
import { allocateCandidates, relaxedQueries, runSearch, SearchFailedError, type SearchDeps } from "@/lib/search";
import { scorePapers, sortByMode } from "@/lib/ranking";
import { SearchRequestSchema, type Capabilities, type Paper } from "@/lib/types";
import { work } from "../fixtures/openalex";

const caps: Capabilities = { llm: true, embeddings: "ready", embeddingModel: "test", openalexKey: false, crossref: false };

const expansion: ExpansionResult = {
  model: "test",
  notice: null,
  variants: [
    { lang: "en", kind: "original", text: "drought rice", concepts: ["drought", "rice"], topic: "drought" },
    { lang: "zh", kind: "translated", text: "干旱 水稻", concepts: ["干旱", "水稻"], topic: "干旱" },
    { lang: "es", kind: "translated", text: "sequía arroz", concepts: ["sequía", "arroz"], topic: "sequía" },
  ],
};

function p(n: number, overrides: Partial<Paper> = {}): Paper {
  return { ...normalizeOpenAlexWork(work({ n }))!, ...overrides };
}

const enPapers = [1, 2, 3, 4, 5].map((n) => p(n));
const zhPapers = [p(1), p(20, { language: "zh", title: "干旱胁迫对水稻产量的影响研究", abstract: null })];

function deps(search: (params: OpenAlexSearchParams) => Promise<SearchResult>, overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    expand: async () => expansion,
    searchOpenAlex: vi.fn(search),
    countByLanguage: null,
    checkLanguages: null,
    searchCrossref: null,
    semantic: async (_q, papers) => ({ scores: new Map(papers.map((x, i) => [x.id, 0.5 + i * 0.01])), notice: null }),
    capabilities: () => caps,
    ...overrides,
  };
}

const request = SearchRequestSchema.parse({ query: "How does drought affect rice?", limit: 10 });

function byLanguage(params: OpenAlexSearchParams): Promise<SearchResult> {
  if (params.languages.includes("zh")) return Promise.resolve({ papers: zhPapers, total: 2 });
  if (params.languages.includes("es")) return Promise.reject(new UpstreamError("OpenAlex", "timeout", "OpenAlex did not respond in time"));
  return Promise.resolve({ papers: enPapers, total: 5 });
}

describe("runSearch", () => {
  it("retrieves each variant in its own language and merges duplicates", async () => {
    const d = deps(byLanguage);
    const res = await runSearch(request, d);
    const calls = (d.searchOpenAlex as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as OpenAlexSearchParams);
    expect(calls.find((c) => c.search === "干旱 水稻")!.languages).toEqual(["zh"]);
    expect(calls.find((c) => c.search === "drought rice")!.languages).toEqual([]);
    // Paper 1 was found by both the English and Chinese queries.
    expect(res.papers).toHaveLength(6);
    const shared = res.papers.find((x) => x.doi === "10.1234/test.1")!;
    expect(shared.retrievedBy.map((r) => r.variantId).sort()).toEqual(["openalex:en:0", "openalex:zh:1"]);
  });

  it("attributes translated-query retrieval correctly", async () => {
    const res = await runSearch(request, deps(byLanguage));
    const zhOnly = res.papers.find((x) => x.language === "zh")!;
    expect(zhOnly.retrievedBy).toEqual([{ variantId: "openalex:zh:1", rank: 2 }]);
    expect(zhOnly.explanations.some((e) => e.kind === "translated")).toBe(true);
    expect(zhOnly.explanations.some((e) => e.kind === "title-only")).toBe(true);
  });

  it("lets every language supply as many candidates as the result list holds", async () => {
    const d = deps(byLanguage);
    const res = await runSearch(request, d);
    const calls = (d.searchOpenAlex as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as OpenAlexSearchParams);
    expect(calls.every((c) => c.perPage === 10)).toBe(true);
    expect(res.candidateCount).toBe(6);
    expect(res.filters).toMatchObject({ limit: 10 });
  });

  it("lets English fill the entire list when English papers are the most relevant", async () => {
    // 10 strong English candidates and 10 weaker candidates in each of two other languages.
    const en = Array.from({ length: 10 }, (_, i) => p(100 + i, { language: "en" }));
    const zh = Array.from({ length: 10 }, (_, i) => p(200 + i, { language: "zh", title: `水稻 研究 ${i}` }));
    const es = Array.from({ length: 10 }, (_, i) => p(300 + i, { language: "es", title: `arroz estudio ${i}` }));
    const d = deps(
      async (params) =>
        params.languages.includes("zh") ? { papers: zh, total: 10 } : params.languages.includes("es") ? { papers: es, total: 10 } : { papers: en, total: 10 },
      { semantic: async (_q, papers) => ({ scores: new Map(papers.map((x) => [x.id, x.language === "en" ? 0.9 : 0.4])), notice: null }) },
    );
    const res = await runSearch(SearchRequestSchema.parse({ query: "drought rice", limit: 10 }), d);
    const top = sortByMode(res.papers, res.effectiveMode).slice(0, res.filters.limit);
    expect(top).toHaveLength(10);
    expect(top.every((x) => x.language === "en")).toBe(true);
  });

  it("shortlists a large pool by title, then scores the shortlist on title + abstract", async () => {
    // 4 languages × 10 candidates = 40 > 3 × limit (5), so stage 1 runs.
    const langs = ["en", "zh", "es", "ja"] as const;
    const pools = Object.fromEntries(langs.map((l, li) => [l, Array.from({ length: 10 }, (_, i) => p(500 + li * 10 + i, { language: l }))]));
    // Quality falls with OpenAlex rank, identically in every language.
    const quality = (x: Paper) => (9 - (Number(x.doi!.split(".").pop()) % 10)) / 10;
    const calls: { field: string; n: number }[] = [];
    const d = deps(
      async (params) => ({ papers: pools[(params.languages[0] as (typeof langs)[number]) ?? "en"] ?? [], total: 10 }),
      {
        expand: async () => ({
          ...expansion,
          variants: [expansion.variants[0], ...langs.slice(1).map((l) => ({ lang: l, kind: "translated" as const, text: l, concepts: [l], topic: l }))],
        }),
        semantic: async (_q, papers, field) => {
          calls.push({ field, n: papers.length });
          return { scores: new Map(papers.map((x) => [x.id, quality(x)])), notice: null };
        },
      },
    );
    const res = await runSearch(SearchRequestSchema.parse({ query: "drought rice", limit: 5 }), d);
    // Equal literatures → equal allocation (4 each of 10), a pool of 16 > 3 × limit.
    expect(res.retrievedCount).toBe(40);
    expect(res.candidateCount).toBe(16);
    expect(calls[0]).toEqual({ field: "title", n: 16 });
    expect(calls[1].field).toBe("full");
    expect(calls[1].n).toBeLessThanOrEqual(16);
    // The best-scoring papers survive the shortlist regardless of language.
    const top = sortByMode(res.papers, "semantic").slice(0, 4);
    expect(new Set(top.map((x) => x.language))).toEqual(new Set(langs));
    expect(top.every((x) => quality(x) === 0.9)).toBe(true);
  });

  it("returns the top N across all languages, with no per-language quota", async () => {
    // 5 English candidates and 10 Chinese ones; the Chinese ones are more relevant here.
    const zhMany = Array.from({ length: 10 }, (_, i) => p(40 + i, { language: "zh", title: `干旱 水稻 产量 研究 ${i}` }));
    const d = deps(
      (params) =>
        Promise.resolve(params.languages.includes("zh") ? { papers: zhMany, total: 10 } : params.languages.length ? { papers: [], total: 0 } : { papers: enPapers, total: 5 }),
      {
        semantic: async (_q, papers) => ({ scores: new Map(papers.map((x) => [x.id, x.language === "zh" ? 0.9 : 0.2])), notice: null }),
        countByLanguage: async () => ({ en: 5_000, zh: 10_000 }),
      },
    );
    const res = await runSearch(SearchRequestSchema.parse({ query: "drought rice", limit: 8 }), d);
    const top = sortByMode(res.papers, res.effectiveMode).slice(0, res.filters.limit);
    expect(top).toHaveLength(8);
    expect(top.every((x) => x.language === "zh")).toBe(true);
    expect(res.candidateCount).toBe(15);
  });

  it("includes each mode's true top N so switching modes client-side is exact", async () => {
    // 12 English candidates; semantic and keyword disagree about which are best.
    const many = Array.from({ length: 12 }, (_, i) =>
      p(60 + i, { title: i % 2 ? `drought rice drought rice yield ${i}` : `unrelated topic ${i}`, abstract: null }),
    );
    let pool: Paper[] = [];
    let scores = new Map<string, number>();
    const d = deps(async (params) => (params.languages.length ? { papers: [], total: 0 } : { papers: many, total: 12 }), {
      semantic: async (_q, papers) => {
        pool = papers;
        // Semantic prefers the "unrelated" titles, so its top 5 differs from BM25's.
        scores = new Map(papers.map((x, i) => [x.id, x.title!.startsWith("unrelated") ? 0.9 - i * 0.01 : 0.1]));
        return { scores, notice: null };
      },
    });
    const res = await runSearch(SearchRequestSchema.parse({ query: "drought rice", limit: 5 }), d);
    const full = scorePapers({ papers: pool, variants: res.variants, semantic: scores });
    const returned = new Set(res.papers.map((x) => x.id));
    for (const mode of ["semantic", "keyword", "hybrid"] as const) {
      const expectedTop = sortByMode(full, mode).slice(0, 5).map((x) => x.id);
      expect(expectedTop.every((id) => returned.has(id))).toBe(true);
      expect(sortByMode(res.papers, mode).slice(0, 5).map((x) => x.id)).toEqual(expectedTop);
    }
  });

  it("passes the original question and every translation to semantic scoring", async () => {
    let received: string[] = [];
    const d = deps(byLanguage, {
      semantic: async (texts, papers) => {
        received = texts;
        return { scores: new Map(papers.map((x) => [x.id, 0.5])), notice: null };
      },
    });
    await runSearch(request, d);
    expect(received).toEqual(["drought rice", "干旱 水稻", "sequía arroz"]);
  });

  it("draws candidates in proportion to each language's matching literature", async () => {
    // Shakespeare-like: every paper is equally relevant; English has ~100x the literature.
    const en = Array.from({ length: 20 }, (_, i) => p(700 + i, { language: "en", title: "Shakespeare" }));
    const it = Array.from({ length: 20 }, (_, i) => p(800 + i, { language: "it", title: "Shakespeare" }));
    const d = deps(
      async (params) => (params.languages.includes("it") ? { papers: it, total: 1_000 } : { papers: en, total: 100_000 }),
      {
        expand: async () => ({
          ...expansion,
          variants: [
            { lang: "en", kind: "original", text: "Shakespeare", concepts: ["shakespeare"], topic: "shakespeare" },
            { lang: "it", kind: "translated", text: "Shakespeare", concepts: ["shakespeare"], topic: "shakespeare" },
          ],
        }),
        semantic: async (_q, papers) => ({ scores: new Map(papers.map((x) => [x.id, 0.88])), notice: null }),
        countByLanguage: async () => ({ en: 100_000, it: 1_000 }),
      },
    );
    const res = await runSearch(SearchRequestSchema.parse({ query: "Shakespeare", limit: 20 }), d);
    expect(res.literatureEstimate).toBe("topic");
    const kept = Object.fromEntries(res.variants.map((v) => [v.lang, v.kept]));
    expect(kept).toEqual({ en: 20, it: 2 }); // Italian keeps only its floor of best matches
    const top = sortByMode(res.papers, res.effectiveMode).slice(0, 20);
    expect(top.filter((x) => x.language === "en").length).toBeGreaterThanOrEqual(18);
  });

  it("sizes literatures with one OR query of every language's topic term", async () => {
    const seen: string[] = [];
    const d = deps(byLanguage, {
      expand: async () => ({
        ...expansion,
        variants: [
          { lang: "en", kind: "original", text: "q", concepts: ["air pollution", "asthma"], topic: "asthma" },
          { lang: "zh", kind: "translated", text: "q", concepts: ["空气污染", "哮喘"], topic: "哮喘" },
          { lang: "es", kind: "translated", text: "q", concepts: ["contaminación del aire"], topic: "asma infantil" },
        ],
      }),
      countByLanguage: async ({ search }) => {
        seen.push(search);
        return { en: 900, zh: 100 };
      },
    });
    const res = await runSearch(request, d);
    expect(seen).toEqual(['"asthma" OR "哮喘" OR "asma infantil"']);
    expect(res.variants.find((v) => v.lang === "zh")!.matchCount).toBe(100);
  });

  it("falls back to each language's overall share of OpenAlex when the count request fails", async () => {
    const res = await runSearch(request, deps(byLanguage, { countByLanguage: async () => Promise.reject(new Error("down")) }));
    expect(res.literatureEstimate).toBe("overall");
    expect(res.variants.find((v) => v.lang === "en")!.matchCount).toBeGreaterThan(res.variants.find((v) => v.lang === "zh")!.matchCount!);
    expect(res.papers.length).toBeGreaterThan(0);
  });

  it("survives one failed variant and reports it", async () => {
    const res = await runSearch(request, deps(byLanguage));
    const es = res.variants.find((v) => v.lang === "es")!;
    expect(es.error).toMatch(/did not respond/);
    expect(res.notices.some((n) => n.includes("Spanish"))).toBe(true);
    expect(res.papers.length).toBeGreaterThan(0);
  });

  it("throws a rate-limit error when every variant is rate limited", async () => {
    const d = deps(() => Promise.reject(new UpstreamError("OpenAlex", "rate_limited", "limit", 429)));
    await expect(runSearch(request, d)).rejects.toBeInstanceOf(SearchFailedError);
    await expect(runSearch(request, d)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("skips translated variants excluded by the publication-language filter", async () => {
    const d = deps(byLanguage);
    const res = await runSearch(SearchRequestSchema.parse({ query: "drought rice", publicationLanguages: ["zh"] }), d);
    expect(res.variants.find((v) => v.lang === "es")!.skipped).toMatch(/excluded/);
    expect(res.papers.every((x) => x.language === "zh")).toBe(true);
    const calls = (d.searchOpenAlex as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as OpenAlexSearchParams);
    expect(calls.find((c) => c.search === "drought rice")!.languages).toEqual(["zh"]);
  });

  it("passes year filters to retrieval and enforces them on merged results", async () => {
    const d = deps(async () => ({ papers: [p(1, { year: 2010 }), p(2, { year: 2018 })], total: 2 }));
    const res = await runSearch(SearchRequestSchema.parse({ query: "drought rice", yearFrom: 2015, yearTo: 2020 }), d);
    const call = (d.searchOpenAlex as ReturnType<typeof vi.fn>).mock.calls[0][0] as OpenAlexSearchParams;
    expect([call.yearFrom, call.yearTo]).toEqual([2015, 2020]);
    expect(res.papers.map((x) => x.year)).toEqual([2018]);
  });

  it("broadens a sparse query step by step and keeps the first query that finds enough", async () => {
    const d = deps(async (params) => {
      if (params.languages.includes("zh")) {
        // Mirrors OpenAlex: long multi-term Chinese queries find nothing; the core term does.
        return params.search === "微塑料" ? { papers: zhPapers.concat([p(30), p(31), p(32)]), total: 1093 } : { papers: [], total: 0 };
      }
      return { papers: enPapers, total: 5 };
    });
    const res = await runSearch(
      request,
      { ...d, expand: async () => ({ ...expansion, variants: [expansion.variants[0], { lang: "zh", kind: "translated", text: "微塑料", concepts: ["微塑料", "海洋", "生态", "影响"], topic: "微塑料" }] }) },
    );
    const zh = res.variants.find((v) => v.lang === "zh")!;
    expect(zh.relaxed).toBe(true);
    expect(zh.searchQuery).toBe("微塑料");
    // Broadening widens retrieval only; keyword scoring still uses every concept.
    expect(zh.concepts).toEqual(["微塑料", "海洋", "生态", "影响"]);
    expect(zh.hitCount).toBe(5);
    const zhSearches = (d.searchOpenAlex as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => (c[0] as OpenAlexSearchParams))
      .filter((c) => c.languages.includes("zh"))
      .map((c) => c.search);
    expect(zhSearches).toEqual(["微塑料 海洋 生态 影响", "微塑料 海洋", "微塑料"]);
  });

  it("does not broaden a query that already found enough papers", async () => {
    const d = deps(async () => ({ papers: enPapers, total: 5 }));
    await runSearch(request, d);
    expect((d.searchOpenAlex as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it("builds the broadening ladder from the most essential terms", () => {
    expect(relaxedQueries(["干ばつ", "イネ", "収量"])).toEqual(["干ばつ イネ", "干ばつ"]);
    expect(relaxedQueries(["drought", "rice"])).toEqual(["drought"]);
    expect(relaxedQueries(["drought"])).toEqual([]);
    // Multi-word concepts are never split.
    expect(relaxedQueries(["contaminación del aire", "asma infantil", "zonas urbanas"])).toEqual([
      "contaminación del aire asma infantil",
      "contaminación del aire",
    ]);
  });

  it("falls back to keyword ranking and says so when semantic scoring is unavailable", async () => {
    const res = await runSearch(
      request,
      deps(byLanguage, { semantic: async () => ({ scores: null, notice: "Semantic ranking is unavailable." }) }),
    );
    expect(res.effectiveMode).toBe("keyword");
    expect(res.availableModes).toEqual(["keyword"]);
    expect(res.notices).toContain("Semantic ranking is unavailable.");
  });
});

describe("allocateCandidates", () => {
  it("scales every language by the same factor, limited by the language that would run out first", () => {
    // Shares 50/30/20. English has only 50 available, so the scale is 100 (50 / 0.5), not the cap.
    expect(allocateCandidates([{ available: 50, matches: 500 }, { available: 50, matches: 300 }, { available: 50, matches: 200 }], 300)).toEqual([
      50, 30, 20,
    ]);
  });

  it("applies the floor to small literatures and never exceeds what was retrieved", () => {
    expect(allocateCandidates([{ available: 100, matches: 99_000 }, { available: 100, matches: 1_000 }, { available: 1, matches: 10 }], 300)).toEqual([
      100, 2, 1,
    ]);
  });

  it("gives languages with no full-query matches (only broadened ones) just the floor", () => {
    expect(allocateCandidates([{ available: 40, matches: 400 }, { available: 40, matches: 0 }], 100)).toEqual([40, 2]);
  });

  it("keeps everything when no match counts are known", () => {
    expect(allocateCandidates([{ available: 7, matches: null }, { available: 3, matches: null }], 100)).toEqual([7, 3]);
  });
});

describe("expandQuery", () => {
  it("uses only the original query and explains why when no LLM is configured", async () => {
    const res = await expandQuery("How does drought affect rice?", "en", ["zh", "es"], { callLlm: null, model: null });
    expect(res.variants).toEqual([{ lang: "en", kind: "original", text: "How does drought affect rice?", concepts: ["drought", "rice"], topic: "drought" }]);
    expect(res.notice).toMatch(/unavailable/);
  });

  it("degrades gracefully when the LLM call fails", async () => {
    const res = await expandQuery("q about rice drought", "en", ["zh"], {
      callLlm: () => Promise.reject(new Error("boom")),
      model: "m",
    });
    expect(res.variants).toHaveLength(1);
    expect(res.notice).toMatch(/failed/);
  });

  it("builds a plan with the original first and sanitized keyword strings", () => {
    const plan = planFromExpansion("drought and rice", "en", ["zh", "ja"], {
      variants: [
        { lang: "en", translation: "drought and rice", keywords: ["drought", "AND rice"], topic: "drought" },
        { lang: "zh", translation: "干旱与水稻", keywords: ['"干旱"', "OR 水稻", "干旱"], topic: "干旱" },
        { lang: "ja", translation: "", keywords: [], topic: "" },
      ],
    });
    expect(plan).toEqual([
      { lang: "en", kind: "original", text: "drought and rice", concepts: ["drought", "rice"], topic: "drought" },
      { lang: "zh", kind: "translated", text: "干旱与水稻", concepts: ["干旱", "水稻"], topic: "干旱" },
    ]);
  });
});
