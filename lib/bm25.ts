import { tokenize } from "./tokenize";

export interface Bm25Doc {
  id: string;
  text: string;
  /**
   * Documents are length-normalized against others in the same group (e.g. title-only vs
   * title + abstract), so a bare title isn't treated as an unusually dense match.
   */
  group?: string;
}

export interface Bm25Result {
  /** Best query-normalized BM25 over all queries, in [0, 1]. */
  score: number;
  matchedTerms: string[];
}

/**
 * Okapi BM25 over the retrieved pool, made comparable across languages.
 *
 * Each query (original + translated variants) is scored independently and a document keeps its
 * best score, so a Chinese paper is scored against the Chinese query terms. Raw BM25 isn't
 * comparable between queries: in a pool that is mostly English, English terms are common (low
 * IDF) while another language's terms are rare (high IDF), which would inflate every non-English
 * score. So each query's score is divided by its own maximum, Σ idf·(k1+1): the result is the
 * share of an ideal match to that query, on the same 0–1 scale for every language.
 */
export function bm25Scores(
  docs: Bm25Doc[],
  queries: string[],
  { k1 = 1.2, b = 0.75 }: { k1?: number; b?: number } = {},
): Map<string, Bm25Result> {
  const docTokens = docs.map((d) => tokenize(d.text));
  const N = docs.length;

  const lengthByGroup = new Map<string, { total: number; count: number }>();
  docs.forEach((d, i) => {
    const g = lengthByGroup.get(d.group ?? "") ?? { total: 0, count: 0 };
    g.total += docTokens[i].length;
    g.count += 1;
    lengthByGroup.set(d.group ?? "", g);
  });
  const avgLen = (group: string | undefined) => {
    const g = lengthByGroup.get(group ?? "");
    return g && g.count ? g.total / g.count || 1 : 1;
  };

  const df = new Map<string, number>();
  const tfs = docTokens.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return tf;
  });
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  const queryTerms = queries
    .map((q) => [...new Set(tokenize(q))])
    .filter((terms) => terms.length)
    .map((terms) => ({ terms, max: terms.reduce((s, t) => s + idf(t) * (k1 + 1), 0) }));
  const out = new Map<string, Bm25Result>();

  docs.forEach((doc, i) => {
    const tf = tfs[i];
    const lengthRatio = docTokens[i].length / avgLen(doc.group);
    let best = 0;
    let bestTerms: string[] = [];
    for (const { terms, max } of queryTerms) {
      let score = 0;
      const matched: string[] = [];
      for (const term of terms) {
        const f = tf.get(term);
        if (!f) continue;
        score += idf(term) * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * lengthRatio)));
        matched.push(term);
      }
      const normalized = max > 0 ? score / max : 0;
      if (normalized > best) {
        best = normalized;
        bestTerms = matched;
      }
    }
    out.set(doc.id, { score: Math.min(best, 1), matchedTerms: bestTerms });
  });
  return out;
}
