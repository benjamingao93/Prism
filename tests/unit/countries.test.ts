import { describe, expect, it, vi } from "vitest";
import { alpha2FromNumeric, countByCountry, countryName } from "@/lib/countries";
import { fetchSourceCountries, normalizeOpenAlexWork } from "@/lib/openalex";
import { runSearch, type SearchDeps } from "@/lib/search";
import { SearchRequestSchema } from "@/lib/types";
import { work } from "../fixtures/openalex";

describe("country helpers", () => {
  it("maps world-atlas numeric ids to ISO alpha-2 codes", () => {
    expect(alpha2FromNumeric("392")).toBe("JP");
    expect(alpha2FromNumeric(76)).toBe("BR"); // zero-padded to "076"
    expect(alpha2FromNumeric(undefined)).toBeNull();
  });

  it("names countries in English", () => {
    expect(countryName("JP")).toBe("Japan");
    expect(countryName(null)).toBe("Country unavailable");
  });

  it("counts papers by venue country, most first, with unknowns separate", () => {
    const { countries, unknown } = countByCountry([{ country: "JP" }, { country: "CN" }, { country: "JP" }, { country: null }]);
    expect(countries).toEqual([
      { code: "JP", count: 2 },
      { code: "CN", count: 1 },
    ]);
    expect(unknown).toBe(1);
  });
});

describe("venue countries from OpenAlex", () => {
  it("keeps the venue's source id when normalizing a work", () => {
    const p = normalizeOpenAlexWork(
      work({ n: 1, primary_location: { landing_page_url: null, source: { id: "https://openalex.org/S123", display_name: "J" } } }),
    )!;
    expect(p.sourceId).toBe("S123");
    expect(p.country).toBeNull();
  });

  it("batches source lookups and parses country codes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({ results: [{ id: "https://openalex.org/S1", country_code: "jp" }, { id: "https://openalex.org/S2", country_code: null }] }),
    );
    const out = await fetchSourceCountries(["S1", "S2", "S1", "not-an-id"], { apiKey: null, mailto: null }, { fetchImpl });
    expect(out).toEqual(
      new Map([
        ["S1", "JP"],
        ["S2", null],
      ]),
    );
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe("/sources");
    expect(url.searchParams.get("filter")).toBe("openalex:S1|S2");
  });

  function deps(sourceCountries: SearchDeps["sourceCountries"]): SearchDeps {
    const papers = [1, 2].map((n) => ({
      ...normalizeOpenAlexWork(work({ n, primary_location: { landing_page_url: null, source: { id: `https://openalex.org/S${n}` } } }))!,
    }));
    return {
      expand: async () => ({ model: null, notice: null, variants: [{ lang: "en", kind: "original", text: "rice", concepts: ["rice"], topic: "rice" }] }),
      searchOpenAlex: async () => ({ papers, total: 2 }),
      countByLanguage: null,
      checkLanguages: null,
      sourceCountries,
      searchCrossref: null,
      semantic: async (_q, ps) => ({ scores: new Map(ps.map((x) => [x.id, 0.5])), notice: null }),
      capabilities: () => ({ llm: false, embeddings: "ready", embeddingModel: "m", openalexKey: true, crossref: false }),
    };
  }

  it("attaches each returned paper's venue country", async () => {
    const res = await runSearch(SearchRequestSchema.parse({ query: "rice" }), deps(async () => new Map([["S1", "JP"], ["S2", null]])));
    expect(Object.fromEntries(res.papers.map((p) => [p.sourceId, p.country]))).toEqual({ S1: "JP", S2: null });
  });

  it("still returns results, with a notice, when the lookup fails", async () => {
    const res = await runSearch(SearchRequestSchema.parse({ query: "rice" }), deps(async () => Promise.reject(new Error("down"))));
    expect(res.papers).toHaveLength(2);
    expect(res.papers.every((p) => p.country === null)).toBe(true);
    expect(res.notices.some((n) => n.includes("Publication countries could not be loaded"))).toBe(true);
  });
});
