import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/http";
import { normalizeOpenAlexWork, type OpenAlexSearchParams, type SearchResult } from "@/lib/openalex";
import { expandQuery, planFromExpansion, type ExpansionResult } from "@/lib/query-expansion";
import { relaxedQuery, runSearch, SearchFailedError, type SearchDeps } from "@/lib/search";
import { SearchRequestSchema, type Capabilities, type Paper } from "@/lib/types";
import { work } from "../fixtures/openalex";

const caps: Capabilities = { llm: true, embeddings: "ready", embeddingModel: "test", openalexKey: false, crossref: false };

const expansion: ExpansionResult = {
  model: "test",
  notice: null,
  variants: [
    { lang: "en", kind: "original", text: "drought rice", searchQuery: "drought rice" },
    { lang: "zh", kind: "translated", text: "干旱 水稻", searchQuery: "干旱 水稻" },
    { lang: "es", kind: "translated", text: "sequía arroz", searchQuery: "sequía arroz" },
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
    searchCrossref: null,
    semantic: async (_q, papers) => ({ scores: new Map(papers.map((x, i) => [x.id, 0.5 + i * 0.01])), notice: null }),
    capabilities: () => caps,
    ...overrides,
  };
}

const request = SearchRequestSchema.parse({ query: "How does drought affect rice?", perVariant: 10 });

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

  it("retries a sparse strict query once with a broader query", async () => {
    const d = deps(async (params) =>
      params.search.includes(" OR ") ? { papers: enPapers, total: 5 } : { papers: [enPapers[0]], total: 1 },
    );
    const res = await runSearch(request, d);
    const en = res.variants.find((v) => v.kind === "original")!;
    expect(en.relaxed).toBe(true);
    expect(en.searchQuery).toBe("drought OR rice");
  });

  it("broadens by dropping the least essential term before resorting to OR", () => {
    expect(relaxedQuery("干ばつ イネ 収量")).toBe("干ばつ イネ");
    expect(relaxedQuery("drought rice")).toBe("drought OR rice");
    expect(relaxedQuery("drought")).toBeNull();
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

describe("expandQuery", () => {
  it("uses only the original query and explains why when no LLM is configured", async () => {
    const res = await expandQuery("How does drought affect rice?", "en", ["zh", "es"], { callLlm: null, model: null });
    expect(res.variants).toEqual([{ lang: "en", kind: "original", text: "How does drought affect rice?", searchQuery: "drought rice" }]);
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
        { lang: "en", translation: "drought and rice", keywords: "drought AND rice" },
        { lang: "zh", translation: "干旱与水稻", keywords: '"干旱" OR 水稻' },
        { lang: "ja", translation: "", keywords: "" },
      ],
    });
    expect(plan).toEqual([
      { lang: "en", kind: "original", text: "drought and rice", searchQuery: "drought rice" },
      { lang: "zh", kind: "translated", text: "干旱与水稻", searchQuery: "干旱 水稻" },
    ]);
  });
});
