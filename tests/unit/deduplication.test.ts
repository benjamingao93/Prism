import { describe, expect, it } from "vitest";
import { mergePapers, normalizeTitle } from "@/lib/deduplication";
import { normalizeOpenAlexWork } from "@/lib/openalex";
import type { Paper } from "@/lib/types";
import { normalizeDoi } from "@/lib/url";
import { work } from "../fixtures/openalex";

function paper(n: number, overrides: Partial<Paper> = {}, variantId = "v-en"): Paper {
  return { ...normalizeOpenAlexWork(work({ n }))!, retrievedBy: [{ variantId, rank: n }], ...overrides };
}

describe("normalizeDoi", () => {
  it.each([
    ["https://doi.org/10.1234/ABC.def", "10.1234/abc.def"],
    ["http://dx.doi.org/10.1234/abc", "10.1234/abc"],
    ["doi:10.1234/abc", "10.1234/abc"],
    ["DOI: 10.1234/Abc", "10.1234/abc"],
    ["10.1234/abc%2Fdef", "10.1234/abc/def"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeDoi(raw)).toBe(expected);
  });

  it("rejects non-DOIs", () => {
    expect(normalizeDoi("not a doi")).toBeNull();
    expect(normalizeDoi("")).toBeNull();
    expect(normalizeDoi(null)).toBeNull();
  });
});

describe("mergePapers", () => {
  it("merges the same DOI across query variants and unions provenance", () => {
    const en = paper(1, {}, "v-en");
    const zh = paper(1, { openalexId: null, id: "doi:10.1234/test.1", retrievedBy: [{ variantId: "v-zh", rank: 4 }] });
    const merged = mergePapers([[en], [zh]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].retrievedBy).toEqual([
      { variantId: "v-en", rank: 1 },
      { variantId: "v-zh", rank: 4 },
    ]);
  });

  it("merges by OpenAlex id when DOI is missing", () => {
    const a = paper(2, { doi: null });
    const b = paper(2, { doi: null, retrievedBy: [{ variantId: "v-es", rank: 1 }] });
    expect(mergePapers([[a], [b]])).toHaveLength(1);
  });

  it("fills missing fields without overwriting existing values", () => {
    const a = paper(3, { abstract: null, venue: "Venue A" });
    const b = paper(3, { abstract: "From second record", venue: "Venue B", retrievedBy: [{ variantId: "v-ja", rank: 2 }] });
    const [m] = mergePapers([[a], [b]]);
    expect(m.abstract).toBe("From second record");
    expect(m.venue).toBe("Venue A");
  });

  it("merges exact long titles with the same year when identifiers differ", () => {
    const a = paper(4, { doi: null, openalexId: "https://openalex.org/W1", id: "https://openalex.org/W1" });
    const b = { ...paper(4, { doi: null, openalexId: null, id: "crossref:x" }), sources: ["crossref" as const] };
    const merged = mergePapers([[a], [b]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toEqual(["openalex", "crossref"]);
  });

  it("does not merge similar but distinct titles", () => {
    const a = paper(5, { doi: null, title: "Drought stress in rice: a review of physiological responses" });
    const b = paper(6, { doi: null, title: "Drought stress in maize: a review of physiological responses" });
    expect(mergePapers([[a], [b]])).toHaveLength(2);
  });

  it("does not merge identical titles from different years", () => {
    const a = paper(7, { doi: null, year: 2019 });
    const b = paper(8, { doi: null, year: 2021, title: a.title });
    expect(mergePapers([[a], [b]])).toHaveLength(2);
  });

  it("never merges records with conflicting DOIs", () => {
    const a = paper(9);
    const b = paper(10, { title: a.title, openalexId: "https://openalex.org/W2", id: "https://openalex.org/W2" });
    expect(mergePapers([[a], [b]])).toHaveLength(2);
  });

  it("normalizes titles across width and punctuation", () => {
    expect(normalizeTitle("Ｒｉｃｅ — Drought: A Study!")).toBe("rice drought a study");
  });
});
