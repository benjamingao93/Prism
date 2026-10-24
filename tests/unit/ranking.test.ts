import { describe, expect, it } from "vitest";
import { bm25Scores } from "@/lib/bm25";
import { availableModes, cosine, HYBRID_WEIGHTS, minMax, resolveMode, scorePapers, selectTopResults, sortByMode } from "@/lib/ranking";
import { extractKeywords, tokenize } from "@/lib/tokenize";
import type { Paper, QueryVariant } from "@/lib/types";

function paper(id: string, title: string, abstract: string | null, language = "en", rank = 1): Paper {
  return {
    id,
    openalexId: id,
    doi: null,
    title,
    authors: [],
    authorCount: 0,
    year: 2020,
    venue: null,
    abstract,
    language,
    landingUrl: null,
    oaUrl: null,
    isOpenAccess: null,
    citedByCount: null,
    type: null,
    sources: ["openalex"],
    retrievedBy: [{ variantId: language === "zh" ? "v-zh" : "v-en", rank }],
  };
}

const variants: QueryVariant[] = [
  { id: "v-en", lang: "en", kind: "original", text: "drought stress rice yield", searchQuery: "drought stress rice yield", concepts: ["drought", "stress", "rice", "yield"], source: "openalex", relaxed: false, hitCount: 2, totalAvailable: 2, error: null, skipped: null },
  { id: "v-zh", lang: "zh", kind: "translated", text: "干旱胁迫对水稻产量的影响", searchQuery: "干旱 水稻 产量", concepts: ["干旱", "水稻", "产量"], source: "openalex", relaxed: false, hitCount: 1, totalAvailable: 1, error: null, skipped: null },
];

describe("tokenize", () => {
  it("segments Chinese into words rather than characters or whole sentences", () => {
    expect(tokenize("干旱胁迫对水稻产量的影响")).toEqual(["干旱", "胁迫", "水稻", "产量"]);
  });

  it("segments Japanese and drops particles", () => {
    expect(tokenize("干ばつストレスがイネの収量")).toEqual(["干ばつ", "ストレス", "イネ", "収量"]);
  });

  it("lowercases, removes stopwords and folds simple plurals", () => {
    expect(tokenize("Effects of Microplastics on the marine ecosystems")).toEqual(["microplastic", "marine", "ecosystem"]);
  });

  it("extracts keywords from a natural-language question", () => {
    expect(extractKeywords("How does drought stress affect rice crop yields?")).toBe("drought stress rice crop yields");
  });
});

describe("bm25Scores", () => {
  it("scores each document against its best-matching query variant", () => {
    const scores = bm25Scores(
      [
        { id: "en", text: "Drought stress reduces rice yield" },
        { id: "zh", text: "干旱胁迫下水稻产量的变化" },
        { id: "off", text: "Deep learning for melanoma detection" },
      ],
      ["drought stress rice yield", "干旱 水稻 产量"],
    );
    expect(scores.get("en")!.score).toBeGreaterThan(0);
    expect(scores.get("zh")!.score).toBeGreaterThan(0);
    expect(scores.get("zh")!.matchedTerms).toEqual(["干旱", "水稻", "产量"]);
    expect(scores.get("off")!.score).toBe(0);
  });
});

describe("bm25Scores fairness across languages", () => {
  const filler = "observational cohort children city exposure measured hospital visits seasonal model results";

  it("gives an equally good match the same score whatever its language's share of the pool", () => {
    // 20 English papers that all contain the English query terms, and a single Indonesian one.
    const english = Array.from({ length: 20 }, (_, i) => ({ id: `en${i}`, text: `air pollution childhood asthma ${filler} ${i}` }));
    const indonesian = { id: "id0", text: "polusi udara asma anak observasi kohort kota paparan rumah sakit musiman model hasil" };
    const scores = bm25Scores([...english, indonesian], ["air pollution childhood asthma", "polusi udara asma anak"]);
    // Both match every term of their own-language query once, in texts of similar length.
    expect(scores.get("id0")!.score).toBeCloseTo(scores.get("en0")!.score, 1);
    expect(scores.get("id0")!.score).toBeLessThanOrEqual(1);
  });

  it("does not treat a bare title as a denser match than an abstract with the same terms", () => {
    const docs = [
      { id: "title-only", text: "air pollution and childhood asthma", group: "title" },
      { id: "other-title", text: "noise and sleep in adults", group: "title" },
      { id: "with-abstract", text: `air pollution and childhood asthma. ${filler} ${filler}`, group: "title+abstract" },
      { id: "other-abstract", text: `noise and sleep in adults. ${filler} ${filler}`, group: "title+abstract" },
    ];
    const s = bm25Scores(docs, ["air pollution childhood asthma"]);
    expect(Math.abs(s.get("title-only")!.score - s.get("with-abstract")!.score)).toBeLessThan(0.05);
    // Without grouping, length normalization would rate the bare title as a far denser match.
    const ungrouped = bm25Scores(docs.map(({ id, text }) => ({ id, text })), ["air pollution childhood asthma"]);
    expect(ungrouped.get("title-only")!.score).toBeGreaterThan(ungrouped.get("with-abstract")!.score * 1.5);
  });
});

describe("normalization", () => {
  it("min-max normalizes to [0, 1]", () => {
    expect(minMax([2, 4, 6])).toEqual([0, 0.5, 1]);
  });
  it("handles equal and empty inputs", () => {
    expect(minMax([3, 3])).toEqual([1, 1]);
    expect(minMax([0, 0])).toEqual([0, 0]);
    expect(minMax([])).toEqual([]);
  });
  it("computes cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("scorePapers and ranking modes", () => {
  const papers = [
    paper("A", "Rice yield under drought stress", "Drought stress reduces rice yield in field trials."),
    paper("B", "干旱胁迫对水稻产量的影响", "研究了干旱胁迫下水稻产量的变化。", "zh"),
    paper("C", "Melanoma detection with deep learning", null),
  ];
  // Deterministic stand-in for embeddings: B is the closest semantic match.
  const semantic = new Map([
    ["A", 0.7],
    ["B", 0.9],
    ["C", 0.1],
  ]);

  it("computes hybrid as 0.7·semantic + 0.3·keyword on normalized scores", () => {
    const ranked = scorePapers({ papers, variants, semantic });
    for (const p of ranked) {
      expect(p.scores.hybrid).toBeCloseTo(HYBRID_WEIGHTS.semantic * p.scores.semantic! + HYBRID_WEIGHTS.keyword * p.scores.keyword);
    }
  });

  it("orders results differently per mode using the corresponding scores", () => {
    const ranked = scorePapers({ papers, variants, semantic });
    expect(sortByMode(ranked, "semantic").map((p) => p.id)).toEqual(["B", "A", "C"]);
    const keywordOrder = sortByMode(ranked, "keyword").map((p) => p.id);
    expect(keywordOrder.at(-1)).toBe("C");
    const kw = Object.fromEntries(ranked.map((p) => [p.id, p.scores.keyword]));
    expect(kw.A).toBeGreaterThan(kw.C);
    expect(kw.B).toBeGreaterThan(kw.C);
  });

  it("does not penalize non-English papers: the Chinese paper matches its translated query", () => {
    const ranked = scorePapers({ papers, variants, semantic });
    const b = ranked.find((p) => p.id === "B")!;
    expect(b.scores.keywordRaw).toBeGreaterThan(0);
    expect(b.explanations.some((e) => e.kind === "translated" && e.text.includes("Chinese"))).toBe(true);
  });

  it("explains title-only scoring and does not claim semantic matches below threshold", () => {
    const ranked = scorePapers({ papers, variants, semantic });
    const c = ranked.find((p) => p.id === "C")!;
    expect(c.textUsed).toBe("title");
    expect(c.explanations.map((e) => e.kind)).toEqual(["title-only"]);
  });

  it("falls back to keyword mode when embeddings are unavailable", () => {
    const ranked = scorePapers({ papers, variants, semantic: null });
    expect(ranked.every((p) => p.scores.semanticRaw === null && p.scores.hybrid === null)).toBe(true);
    const modes = availableModes(ranked, false);
    expect(modes).toEqual(["keyword"]);
    expect(resolveMode("hybrid", modes)).toBe("keyword");
    expect(resolveMode("semantic", availableModes(scorePapers({ papers, variants, semantic }), true))).toBe("semantic");
  });

  it("selects the union of each mode's top N plus the baseline's top papers", () => {
    const ranked = scorePapers({ papers, variants, semantic });
    // Top-1 by semantic is B; top-1 by keyword is A or B; the English baseline's top-1 is A.
    const selected = selectTopResults(ranked, ["semantic", "keyword"], "semantic", 1, { variantId: "v-en", k: 1 });
    const ids = selected.map((p) => p.id);
    expect(ids[0]).toBe("B");
    expect(ids).toContain(sortByMode(ranked, "keyword")[0].id);
    expect(ids).toContain("A");
    expect(ids).not.toContain("C");
  });

  it("scores keywords against all concepts, not a broadened search string", () => {
    const broadened: QueryVariant[] = [
      variants[0],
      { ...variants[1], searchQuery: "水稻", relaxed: true, concepts: ["水稻", "干旱", "产量"] },
    ];
    const ranked = scorePapers({
      papers: [paper("full", "干旱 水稻 产量", null, "zh"), paper("broad-only", "水稻 栽培 技术", null, "zh")],
      variants: broadened,
      semantic: null,
    });
    const kw = Object.fromEntries(ranked.map((p) => [p.id, p.scores.keywordRaw]));
    expect(kw["full"]).toBeGreaterThan(kw["broad-only"] * 2);
  });

  it("never uses publication language in the score", () => {
    const en = scorePapers({ papers: [paper("X", "rice drought", "rice drought", "en")], variants, semantic: new Map([["X", 0.5]]) })[0];
    const ja = scorePapers({ papers: [paper("X", "rice drought", "rice drought", "ja")], variants, semantic: new Map([["X", 0.5]]) })[0];
    expect(ja.scores).toEqual(en.scores);
  });
});
