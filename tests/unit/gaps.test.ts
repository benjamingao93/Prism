import { describe, expect, it, vi } from "vitest";
import { GapAnalysisError, runGapAnalysis, type GapDeps } from "@/lib/gap-analysis";
import {
  assembleThemes,
  buildGapsPrompt,
  buildOverviewPrompt,
  computeHighlights,
  defaultBaseline,
  dropOffTopic,
  gapsRequestFor,
  sampleByLanguage,
  type GapsResponse,
  type GapTheme,
} from "@/lib/gaps";
import { UpstreamError } from "@/lib/http";
import { normalizeOpenAlexWork, type OpenAlexSearchParams, type SearchResult } from "@/lib/openalex";
import type { ExpansionResult } from "@/lib/query-expansion";
import { runSearch, type SearchDeps } from "@/lib/search";
import { SearchRequestSchema, type Capabilities, type Paper } from "@/lib/types";
import { work } from "../fixtures/openalex";

function p(n: number, language: string, overrides: Partial<Paper> = {}): Paper {
  return { ...normalizeOpenAlexWork(work({ n, language }))!, ...overrides };
}

describe("sampleByLanguage", () => {
  it("keeps each language's most relevant papers and sets aside languages with too few", () => {
    const papers = [p(1, "en"), p(2, "en"), p(3, "en"), p(4, "en"), p(5, "hi"), p(6, "hi"), p(7, "hi"), p(8, "sw")];
    const scores = new Map(papers.map((x, i) => [x.id, i === 0 ? 0.1 : 0.9 - i * 0.01]));
    const { groups, excluded } = sampleByLanguage(papers, scores, 3, 3);
    // The lowest-scoring English paper (paper 1) falls outside the top 3.
    expect(groups.get("en")!.map((x) => x.id)).not.toContain(papers[0].id);
    expect(groups.get("hi")).toHaveLength(3);
    expect(groups.has("sw")).toBe(false);
    expect(excluded).toEqual([{ code: "sw", total: 1 }]);
  });
});

describe("assembleThemes", () => {
  const groups = new Map([
    ["en", [p(1, "en"), p(2, "en")]],
    ["hi", [p(3, "hi")]],
  ]);
  const { ids } = buildGapsPrompt("Ganges pollution", groups);

  it("maps short ids back to papers and groups evidence by language", () => {
    const themes = assembleThemes(
      {
        themes: [
          { id: "T1", label: "Heavy metals", description: "Metal contamination." },
          { id: "T2", label: "Ritual bathing", description: "Religious use." },
        ],
        assignments: [
          { paper: "P1", themes: ["T1"] },
          { paper: "P2", themes: ["T1"] },
          { paper: "P3", themes: ["T1", "T2"] },
        ],
        off_topic: [],
      },
      ids,
      groups,
    );
    expect(themes.find((t) => t.id === "T1")!.papers).toEqual({ en: [groups.get("en")![0].id, groups.get("en")![1].id], hi: [groups.get("hi")![0].id] });
    expect(themes.find((t) => t.id === "T2")!.papers).toEqual({ hi: [groups.get("hi")![0].id] });
  });

  it("ignores unknown papers and themes, repeated assignments, and themes nothing was tagged with", () => {
    const themes = assembleThemes(
      {
        themes: [
          { id: "T1", label: "Heavy metals", description: "" },
          { id: "T9", label: "Never used", description: "" },
        ],
        assignments: [
          { paper: "P1", themes: ["T1", "T7"] },
          { paper: "P1", themes: ["T1"] },
          { paper: "P99", themes: ["T1"] },
        ],
        off_topic: [],
      },
      ids,
      groups,
    );
    expect(themes.map((t) => t.id)).toEqual(["T1"]);
    expect(themes[0].papers).toEqual({ en: [groups.get("en")![0].id] });
  });
});

describe("dropOffTopic", () => {
  it("removes off-topic papers from every count and sets aside languages left with too few", () => {
    const groups = new Map([
      ["en", [p(1, "en"), p(2, "en"), p(3, "en"), p(4, "en")]],
      ["de", [p(5, "de"), p(6, "de"), p(7, "de")]],
    ]);
    const { ids } = buildGapsPrompt("Ganges pollution", groups);
    // P4 (English) and P6, P7 (German: "Gang" papers) are not about the Ganges.
    const kept = dropOffTopic(groups, ids, ["P4", "P6", "P7", "P99"], 3);
    expect(kept.groups.get("en")).toHaveLength(3);
    expect(kept.groups.has("de")).toBe(false);
    expect(kept.excluded).toEqual([{ code: "de", total: 1 }]);
    expect(kept.offTopic).toEqual([
      { code: "de", count: 2 },
      { code: "en", count: 1 },
    ]);
    // Tags on removed papers don't count.
    const themes = assembleThemes(
      { themes: [{ id: "T1", label: "Heavy metals", description: "" }], assignments: [{ paper: "P4", themes: ["T1"] }], off_topic: [] },
      ids,
      kept.groups,
    );
    expect(themes).toEqual([]);
  });
});

describe("buildOverviewPrompt", () => {
  it("gives the model only the computed differences, with their counts", () => {
    const theme: GapTheme = { id: "T1", label: "Ritual bathing", description: "", papers: { hi: ["a", "b"], en: [] } };
    const prompt = buildOverviewPrompt(
      "Ganges",
      [{ theme, language: "hi", direction: "more", here: { count: 6, total: 15, share: 0.4 }, baseline: { count: 1, total: 15, share: 1 / 15 }, diff: 0.33 }],
      "en",
    );
    expect(prompt).toContain('- Hindi papers discuss "Ritual bathing" more often than English papers: 6 of 15 vs 1 of 15.');
  });
});

describe("computeHighlights", () => {
  const languages = [
    { code: "en", total: 10 },
    { code: "hi", total: 5 },
  ];
  const theme = (id: string, en: number, hi: number): GapTheme => ({
    id,
    label: id,
    description: "",
    papers: {
      ...(en ? { en: Array.from({ length: en }, (_, i) => `en${i}`) } : {}),
      ...(hi ? { hi: Array.from({ length: hi }, (_, i) => `hi${i}`) } : {}),
    },
  });

  it("points out themes one language covers much more, in either direction, strongest first", () => {
    const res: Pick<GapsResponse, "languages" | "themes"> = {
      languages,
      themes: [theme("ritual", 0, 4), theme("metals", 8, 1), theme("shared", 5, 3), theme("rare", 0, 1)],
    };
    const h = computeHighlights(res, "en");
    expect(h.map((x) => [x.theme.id, x.direction])).toEqual([
      ["ritual", "more"], // 80% vs 0%
      ["metals", "less"], // 20% vs 80%
    ]);
    expect(h[0].here).toEqual({ count: 4, total: 5, share: 0.8 });
    // 60% vs 50% is too close; a single paper is too few.
  });

  it("defaults the baseline to English, else the largest language", () => {
    expect(defaultBaseline(languages)).toBe("en");
    expect(defaultBaseline([{ code: "fr", total: 9 }, { code: "hi", total: 4 }])).toBe("fr");
  });
});

describe("runGapAnalysis", () => {
  const caps: Capabilities = { llm: true, embeddings: "ready", embeddingModel: "test", openalexKey: false, crossref: false };
  const expansion: ExpansionResult = {
    model: "test",
    notice: null,
    variants: [
      { lang: "en", kind: "original", text: "Ganges pollution", concepts: ["Ganges", "pollution"], topic: "Ganges" },
      { lang: "hi", kind: "translated", text: "गंगा प्रदूषण", concepts: ["गंगा", "प्रदूषण"], topic: "गंगा" },
    ],
  };
  const en = [1, 2, 3, 4].map((n) => p(n, "en"));
  const hi = [5, 6, 7].map((n) => p(n, "hi"));
  const search = (params: OpenAlexSearchParams): Promise<SearchResult> =>
    Promise.resolve(params.languages.includes("hi") ? { papers: hi, total: 3 } : { papers: en, total: 4 });
  const semantic: SearchDeps["semantic"] = async (_q, papers) => ({ scores: new Map(papers.map((x) => [x.id, 0.5])), notice: null });

  async function searched() {
    const searchSpy = vi.fn(search);
    const deps: SearchDeps = {
      expand: async () => expansion,
      searchOpenAlex: searchSpy,
      countByLanguage: null,
      checkLanguages: null,
      sourceCountries: null,
      searchCrossref: null,
      semantic,
      capabilities: () => caps,
    };
    const response = await runSearch(SearchRequestSchema.parse({ query: "Ganges pollution", limit: 10 }), deps);
    return { response, searchSpy };
  }

  it("re-runs the search's queries with identical parameters, so OpenAlex responses come from its cache", async () => {
    const { response, searchSpy } = await searched();
    const gapSearch = vi.fn(search);
    const themes = vi.fn<GapDeps["themes"]>(async () => ({
      model: "test-model",
      data: {
        themes: [{ id: "T1", label: "Ritual bathing", description: "Religious use of the river." }],
        assignments: [
          { paper: "P5", themes: ["T1"] },
          { paper: "P6", themes: ["T1"] },
        ],
        off_topic: [],
      },
    }));
    const overview = vi.fn<NonNullable<GapDeps["overview"]>>(async () => "Hindi papers discuss ritual use.");
    const res = await runGapAnalysis(gapsRequestFor(response), { searchOpenAlex: gapSearch, checkLanguages: null, semantic, themes, overview });

    // Every request is one the search already made (it also tried broader retries, which aren't repeated).
    const key = (c: unknown[]) => JSON.stringify(c[0]);
    expect(gapSearch).toHaveBeenCalledTimes(2);
    expect(searchSpy.mock.calls.map(key)).toEqual(expect.arrayContaining(gapSearch.mock.calls.map(key)));
    expect(res.languages).toEqual([
      { code: "en", total: 4 },
      { code: "hi", total: 3 },
    ]);
    expect(res.themes[0].papers.hi).toHaveLength(2);
    expect(res.papers).toHaveLength(7);
    expect(themes).toHaveBeenCalledOnce();
    // The summary is written from Prism's counts, not from the papers.
    expect(overview.mock.calls[0][1]).toContain('Hindi papers discuss "Ritual bathing" more often than English papers: 2 of 3 vs 0 of 4.');
    expect(res.overview).toBe("Hindi papers discuss ritual use.");
  });

  it("leaves off-topic papers out of every count", async () => {
    const { response } = await searched();
    const themes = vi.fn<GapDeps["themes"]>(async () => ({
      model: "test-model",
      data: {
        themes: [{ id: "T1", label: "Ritual bathing", description: "" }],
        assignments: [
          { paper: "P1", themes: ["T1"] },
          { paper: "P5", themes: ["T1"] },
        ],
        // Two of the three Hindi papers aren't about the question, so Hindi can't be compared.
        off_topic: ["P6", "P7"],
      },
    }));
    const overview = vi.fn<NonNullable<GapDeps["overview"]>>();
    const res = await runGapAnalysis(gapsRequestFor(response), { searchOpenAlex: vi.fn(search), checkLanguages: null, semantic, themes, overview });
    expect(res.languages).toEqual([{ code: "en", total: 4 }]);
    expect(res.excluded).toEqual([{ code: "hi", total: 1 }]);
    expect(res.offTopic).toEqual([{ code: "hi", count: 2 }]);
    expect(res.themes).toEqual([]);
    expect(overview).not.toHaveBeenCalled();
  });

  it("skips the LLM when fewer than two languages have enough papers", async () => {
    const { response } = await searched();
    const themes = vi.fn<GapDeps["themes"]>();
    const onlyEnglish = (params: OpenAlexSearchParams): Promise<SearchResult> =>
      Promise.resolve(params.languages.includes("hi") ? { papers: [hi[0]], total: 1 } : { papers: en, total: 4 });
    const res = await runGapAnalysis(gapsRequestFor(response), { searchOpenAlex: onlyEnglish, checkLanguages: null, semantic, themes, overview: null });
    expect(themes).not.toHaveBeenCalled();
    expect(res.themes).toEqual([]);
    expect(res.excluded).toEqual([{ code: "hi", total: 1 }]);
    expect(res.notices.at(-1)).toMatch(/two languages/);
  });

  it("reports a rate limit when no language could be retrieved", async () => {
    const { response } = await searched();
    const limited = () => Promise.reject(new UpstreamError("OpenAlex", "rate_limited", "limit", 429));
    await expect(
      runGapAnalysis(gapsRequestFor(response), { searchOpenAlex: limited, checkLanguages: null, semantic, themes: vi.fn(), overview: null }),
    ).rejects.toMatchObject({ code: "rate_limited" } satisfies Partial<GapAnalysisError>);
  });
});
