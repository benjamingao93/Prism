import { tokenize } from "./tokenize";

export interface Bm25Doc {
  id: string;
  text: string;
}

export interface Bm25Result {
  score: number;
  matchedTerms: string[];
}

/**
 * Okapi BM25 over the retrieved pool. Each query (original + translated variants) is scored
 * independently and a document keeps its best score, so a Chinese paper is scored against the
 * Chinese query terms rather than penalized for lacking English ones.
 */
export function bm25Scores(
  docs: Bm25Doc[],
  queries: string[],
  { k1 = 1.2, b = 0.75 }: { k1?: number; b?: number } = {},
): Map<string, Bm25Result> {
  const docTokens = docs.map((d) => tokenize(d.text));
  const N = docs.length;
  const avgLen = N ? docTokens.reduce((s, t) => s + t.length, 0) / N || 1 : 1;

  const df = new Map<string, number>();
  const tfs = docTokens.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return tf;
  });

  const queryTerms = queries.map((q) => [...new Set(tokenize(q))]).filter((q) => q.length);
  const out = new Map<string, Bm25Result>();

  docs.forEach((doc, i) => {
    const tf = tfs[i];
    const len = docTokens[i].length;
    let best = 0;
    let bestTerms: string[] = [];
    for (const terms of queryTerms) {
      let score = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const f = tf.get(term);
        if (!f) continue;
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
        matched.push(term);
      }
      if (score > best) {
        best = score;
        bestTerms = matched;
      }
    }
    out.set(doc.id, { score: best, matchedTerms: bestTerms });
  });
  return out;
}
