import { bm25Scores } from "./bm25";
import { languageName } from "./languages";
import type { Explanation, Paper, QueryVariant, RankedPaper, RankingMode, ScoreBreakdown } from "./types";

/** Tunable starting weights — not validated constants. */
export const HYBRID_WEIGHTS = { semantic: 0.7, keyword: 0.3 } as const;

/** Heuristic cosine thresholds for the multilingual MiniLM model; used only for wording. */
export const SEMANTIC_THRESHOLDS = { strong: 0.6, moderate: 0.4 } as const;

/** Min-max normalize to [0, 1]. If every value is equal, positive values map to 1 and zeros to 0. */
export function minMax(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-12) return values.map((v) => (v > 0 ? 1 : 0));
  return values.map((v) => (v - min) / (max - min));
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Text used for both embedding and BM25. Only real metadata — nothing is generated. */
export function paperText(p: Pick<Paper, "title" | "abstract">): string {
  return [p.title, p.abstract].filter(Boolean).join(". ");
}

export interface ScoringInput {
  papers: Paper[];
  variants: QueryVariant[];
  /** Cosine similarity per paper id; omit when semantic ranking is unavailable. */
  semantic?: Map<string, number> | null;
}

export function scorePapers({ papers, variants, semantic }: ScoringInput): RankedPaper[] {
  const queries = variants
    .filter((v) => !v.skipped)
    .flatMap((v) => (v.text === v.searchQuery ? [v.text] : [v.text, v.searchQuery]));
  const bm25 = bm25Scores(
    papers.map((p) => ({ id: p.id, text: paperText(p) })),
    queries,
  );

  const keywordRaw = papers.map((p) => bm25.get(p.id)?.score ?? 0);
  const keywordNorm = minMax(keywordRaw);
  const hasSemantic = Boolean(semantic && papers.some((p) => semantic.has(p.id)));
  const semanticRaw = papers.map((p) => (hasSemantic ? (semantic!.get(p.id) ?? null) : null));
  const semanticNormList = hasSemantic ? minMax(semanticRaw.map((s) => s ?? 0)) : [];

  const variantById = new Map(variants.map((v) => [v.id, v]));

  return papers.map((p, i) => {
    const semNorm = hasSemantic && semanticRaw[i] != null ? semanticNormList[i] : null;
    const scores: ScoreBreakdown = {
      semanticRaw: semanticRaw[i],
      semantic: semNorm,
      keywordRaw: keywordRaw[i],
      keyword: keywordNorm[i],
      hybrid: semNorm == null ? null : HYBRID_WEIGHTS.semantic * semNorm + HYBRID_WEIGHTS.keyword * keywordNorm[i],
      matchedTerms: bm25.get(p.id)?.matchedTerms ?? [],
    };
    const textUsed: RankedPaper["textUsed"] = p.abstract ? "title+abstract" : p.title ? "title" : "none";
    return { ...p, scores, textUsed, explanations: buildExplanations(p, scores, textUsed, variantById) };
  });
}

export function buildExplanations(
  paper: Paper,
  scores: ScoreBreakdown,
  textUsed: RankedPaper["textUsed"],
  variantById: Map<string, QueryVariant>,
): Explanation[] {
  const out: Explanation[] = [];
  const cos = scores.semanticRaw;
  if (cos != null && cos >= SEMANTIC_THRESHOLDS.strong) {
    out.push({ kind: "semantic", text: `Strong semantic match to your question (cosine ${cos.toFixed(2)})` });
  } else if (cos != null && cos >= SEMANTIC_THRESHOLDS.moderate) {
    out.push({ kind: "semantic", text: `Moderate semantic match to your question (cosine ${cos.toFixed(2)})` });
  }

  if (scores.matchedTerms.length) {
    const shown = scores.matchedTerms.slice(0, 5).join(", ");
    out.push({ kind: "terms", text: `Contains query terms: ${shown}` });
  }

  const translated = paper.retrievedBy
    .map((r) => variantById.get(r.variantId))
    .filter((v): v is QueryVariant => Boolean(v && v.kind === "translated"));
  for (const v of translated.slice(0, 2)) {
    out.push({ kind: "translated", text: `Retrieved via ${languageName(v.lang)} query “${v.searchQuery}”` });
  }

  if (paper.retrievedBy.length > 1) {
    out.push({ kind: "multi", text: `Retrieved by ${paper.retrievedBy.length} query variants` });
  }
  if (textUsed === "title") {
    out.push({ kind: "title-only", text: "Scored on title only — no abstract available" });
  }
  return out;
}

/** Score that the given mode sorts by. Semantic uses raw cosine; others use normalized scores. */
export function scoreFor(p: RankedPaper, mode: RankingMode): number | null {
  if (mode === "semantic") return p.scores.semanticRaw;
  if (mode === "hybrid") return p.scores.hybrid;
  return p.scores.keyword;
}

export function availableModes(papers: RankedPaper[], semanticAvailable: boolean): RankingMode[] {
  return semanticAvailable && papers.some((p) => p.scores.semanticRaw != null)
    ? ["hybrid", "semantic", "keyword"]
    : ["keyword"];
}

export function resolveMode(requested: RankingMode, available: RankingMode[]): RankingMode {
  return available.includes(requested) ? requested : "keyword";
}

function bestRank(p: Paper): number {
  return p.retrievedBy.length ? Math.min(...p.retrievedBy.map((r) => r.rank)) : Number.MAX_SAFE_INTEGER;
}

/** Sort a copy by the mode's score (desc). Ties: BM25 raw, then best source rank. */
export function sortByMode(papers: RankedPaper[], mode: RankingMode): RankedPaper[] {
  return [...papers].sort((a, b) => {
    const sa = scoreFor(a, mode) ?? -Infinity;
    const sb = scoreFor(b, mode) ?? -Infinity;
    if (sb !== sa) return sb - sa;
    if (b.scores.keywordRaw !== a.scores.keywordRaw) return b.scores.keywordRaw - a.scores.keywordRaw;
    return bestRank(a) - bestRank(b);
  });
}

export function relevanceLabel(p: RankedPaper, mode: RankingMode): { label: string; tone: "high" | "medium" | "low" } {
  const s = scoreFor(p, mode) ?? 0;
  if (mode === "semantic") {
    if (s >= SEMANTIC_THRESHOLDS.strong) return { label: "Strong match", tone: "high" };
    if (s >= SEMANTIC_THRESHOLDS.moderate) return { label: "Moderate match", tone: "medium" };
    return { label: "Weak match", tone: "low" };
  }
  // Keyword and hybrid scores are min-max normalized, so these labels are relative to the result set.
  if (s >= 0.66) return { label: "High", tone: "high" };
  if (s >= 0.33) return { label: "Medium", tone: "medium" };
  return { label: "Low", tone: "low" };
}
