import { describe, expect, it, vi } from "vitest";
import { buildOpenAlexUrl, countWorksByLanguage, normalizeOpenAlexWork, orQuery, reconstructAbstract, searchOpenAlex } from "@/lib/openalex";
import { listResponse, work } from "../fixtures/openalex";

describe("reconstructAbstract", () => {
  it("rebuilds word order from the inverted index", () => {
    expect(reconstructAbstract({ world: [1], Hello: [0], again: [3], "hello,": [2] })).toBe("Hello world hello, again");
  });

  it("returns null for missing or empty indexes", () => {
    expect(reconstructAbstract(null)).toBeNull();
    expect(reconstructAbstract(undefined)).toBeNull();
    expect(reconstructAbstract({})).toBeNull();
  });

  it("ignores malformed positions", () => {
    expect(reconstructAbstract({ ok: [0], bad: [-1, 1.5] as number[] })).toBe("ok");
  });
});

describe("normalizeOpenAlexWork", () => {
  it("normalizes a complete record", () => {
    const p = normalizeOpenAlexWork(work({ n: 1 }))!;
    expect(p).toMatchObject({
      id: "https://openalex.org/W900000001",
      doi: "10.1234/test.1",
      title: "Synthetic test paper 1 on drought stress in rice",
      authors: ["Test Author A", "Test Author B"],
      authorCount: 2,
      year: 2020,
      venue: "Test Journal",
      abstract: "Drought reduces rice yield",
      language: "en",
      landingUrl: "https://example.org/paper/1",
      sources: ["openalex"],
    });
  });

  it("keeps missing abstract and unknown language as null instead of inventing values", () => {
    const p = normalizeOpenAlexWork(work({ n: 2, abstract_inverted_index: null, language: null }))!;
    expect(p.abstract).toBeNull();
    expect(p.language).toBeNull();
  });

  it("rejects malformed language codes", () => {
    expect(normalizeOpenAlexWork(work({ n: 3, language: "English!" }))!.language).toBeNull();
  });

  it("handles malformed authorships and missing venue", () => {
    const p = normalizeOpenAlexWork(
      work({ n: 4, authorships: [null, { author: null }, { author: { display_name: "Real Name" } }], primary_location: null }),
    )!;
    expect(p.authors).toEqual(["Real Name"]);
    expect(p.venue).toBeNull();
    // Falls back to DOI resolver when there is no landing page.
    expect(p.landingUrl).toBe("https://doi.org/10.1234/test.4");
  });

  it("strips markup from titles", () => {
    expect(normalizeOpenAlexWork(work({ n: 5, title: "Growth of <i>Oryza sativa</i> &amp; drought" }))!.title).toBe(
      "Growth of Oryza sativa & drought",
    );
  });

  it("rejects unsafe URLs", () => {
    const p = normalizeOpenAlexWork(
      work({
        n: 6,
        primary_location: { landing_page_url: "javascript:alert(1)", source: null },
        open_access: { is_oa: true, oa_url: "data:text/html,hi" },
      }),
    )!;
    expect(p.landingUrl).toBe("https://doi.org/10.1234/test.6");
    expect(p.oaUrl).toBeNull();
  });

  it("drops records with neither an OpenAlex id nor a DOI", () => {
    expect(normalizeOpenAlexWork(work({ n: 7, id: null, doi: null }))).toBeNull();
  });
});

describe("buildOpenAlexUrl", () => {
  it("encodes search, language and year filters", () => {
    const url = new URL(
      buildOpenAlexUrl(
        { search: "干旱 水稻", languages: ["zh"], yearFrom: 2015, yearTo: 2020, perPage: 25 },
        { apiKey: null, mailto: "a@b.c" },
      ),
    );
    expect(url.searchParams.get("search.title_and_abstract")).toBe("干旱 水稻");
    expect(url.searchParams.get("filter")).toBe("language:zh,from_publication_date:2015-01-01,to_publication_date:2020-12-31");
    expect(url.searchParams.get("per_page")).toBe("25");
    expect(url.searchParams.get("mailto")).toBe("a@b.c");
    expect(url.searchParams.has("api_key")).toBe(false);
  });

  it("omits the filter parameter when no filters apply", () => {
    const url = new URL(buildOpenAlexUrl({ search: "x", languages: [], yearFrom: null, yearTo: null, perPage: 10 }, { apiKey: "k", mailto: null }));
    expect(url.searchParams.has("filter")).toBe(false);
    expect(url.searchParams.get("api_key")).toBe("k");
  });
});

describe("searchOpenAlex", () => {
  const params = { search: "rice", languages: [], yearFrom: null, yearTo: null, perPage: 5 };
  const config = { apiKey: null, mailto: null };

  it("retries on 429 and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(Response.json(listResponse([work({ n: 1 })], 99)));
    const result = await searchOpenAlex(params, config, { fetchImpl, sleep: async () => {} });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.papers).toHaveLength(1);
    expect(result.total).toBe(99);
  });

  it("throws a typed rate-limit error after exhausting retries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    await expect(searchOpenAlex(params, config, { fetchImpl, sleep: async () => {} })).rejects.toMatchObject({
      name: "UpstreamError",
      kind: "rate_limited",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    await expect(searchOpenAlex(params, config, { fetchImpl, sleep: async () => {} })).rejects.toMatchObject({ kind: "http", status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps timeouts to a typed timeout error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(searchOpenAlex(params, config, { fetchImpl, sleep: async () => {} })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("tolerates a response without results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ meta: null }));
    const result = await searchOpenAlex(params, config, { fetchImpl, sleep: async () => {} });
    expect(result).toEqual({ papers: [], total: null });
  });
});

describe("literature counts", () => {
  it("builds an OR query, quoting phrases and dropping duplicates", () => {
    expect(orQuery(["asthma", "哮喘", "asma infantil", "asthma", ""])).toBe('"asthma" OR "哮喘" OR "asma infantil"');
  });

  it("parses per-language counts from a group_by response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        group_by: [
          { key: "https://openalex.org/languages/en", count: 899 },
          { key: "zh", count: 100 },
          { key: null, count: 5 },
          // A second key for the same language must add to, not replace, the first.
          { key: "EN", count: 1 },
        ],
      }),
    );
    const counts = await countWorksByLanguage({ search: "asthma OR 哮喘", yearFrom: 2015, yearTo: null }, { apiKey: null, mailto: null }, { fetchImpl });
    expect(counts).toEqual({ en: 900, zh: 100 });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get("group_by")).toBe("language");
    expect(url.searchParams.get("filter")).toBe("from_publication_date:2015-01-01");
  });
});
