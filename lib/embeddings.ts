import "server-only";
import { createHash } from "node:crypto";
import { globalCache } from "./cache";
import { env } from "./env";
import { cosine, paperText } from "./ranking";
import type { EmbeddingStatus, Paper } from "./types";

/** Embeds a batch of texts into unit vectors. */
type Extractor = (texts: string[]) => Promise<number[][]>;

/**
 * The sentence-transformers reference config for this model truncates input at 128 tokens (its
 * training length). Transformers.js defaults to 512, so we tokenize explicitly to match.
 */
const MAX_TOKENS = 128;
/** Bound tokenizer work on very long abstracts; far more than 128 tokens in any script. */
const MAX_CHARS = 2000;

interface EmbeddingState {
  status: EmbeddingStatus;
  promise: Promise<Extractor | null> | null;
  extractor: Extractor | null;
  error: string | null;
}

const g = globalThis as unknown as { __babelEmbeddings?: EmbeddingState };
const state: EmbeddingState = (g.__babelEmbeddings ??= {
  status: "idle",
  promise: null,
  extractor: null,
  error: null,
});

const vectorCache = globalCache<number[]>("embeddings", 20_000, 7 * 24 * 60 * 60 * 1000);

export function embeddingStatus(): EmbeddingStatus {
  return env().EMBEDDINGS_ENABLED ? state.status : "disabled";
}

export function embeddingModelName(): string | null {
  return env().EMBEDDINGS_ENABLED ? env().EMBEDDING_MODEL : null;
}

/** Start loading the model (downloads on first run). Safe to call repeatedly. */
export function loadEmbeddings(): Promise<Extractor | null> {
  if (!env().EMBEDDINGS_ENABLED) return Promise.resolve(null);
  if (state.promise) return state.promise;
  state.status = "loading";
  state.promise = (async () => {
    try {
      const transformers = await import("@huggingface/transformers");
      transformers.env.cacheDir = env().EMBEDDING_CACHE_DIR;
      const pipe = await transformers.pipeline("feature-extraction", env().EMBEDDING_MODEL, { dtype: "q8" });
      state.extractor = async (texts) => {
        const inputs = pipe.tokenizer(texts, { padding: true, truncation: true, max_length: MAX_TOKENS });
        const { last_hidden_state } = await pipe.model(inputs);
        return transformers.mean_pooling(last_hidden_state, inputs.attention_mask).normalize(2, -1).tolist() as number[][];
      };
      state.status = "ready";
      return state.extractor;
    } catch (err) {
      state.status = "failed";
      state.error = err instanceof Error ? err.message : String(err);
      console.error("[embeddings] model failed to load:", state.error);
      // Allow a later retry.
      state.promise = null;
      return null;
    }
  })();
  return state.promise;
}

function key(text: string): string {
  return createHash("sha1").update(env().EMBEDDING_MODEL).update("\0").update(text).digest("hex");
}

async function embed(extractor: Extractor, texts: string[]): Promise<number[][]> {
  const out: (number[] | undefined)[] = texts.map((t) => vectorCache.get(key(t)));
  const missing = texts.map((t, i) => (out[i] ? -1 : i)).filter((i) => i >= 0);
  const BATCH = 32;
  for (let start = 0; start < missing.length; start += BATCH) {
    const idx = missing.slice(start, start + BATCH);
    const vectors = await extractor(idx.map((i) => texts[i]));
    vectors.forEach((vec, j) => {
      out[idx[j]] = vec;
      vectorCache.set(key(texts[idx[j]]), vec);
    });
  }
  return out as number[][];
}

/** Mean of unit vectors, re-normalized: a single direction representing all of them. */
export function centroid(vectors: number[][]): number[] {
  const dims = vectors[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const v of vectors) for (let i = 0; i < dims; i++) sum[i] += v[i];
  const norm = Math.hypot(...sum) || 1;
  return sum.map((x) => x / norm);
}

export type SemanticField = "title" | "full";

/**
 * Cosine similarity between the question and each paper's text. "title" scores titles only (a
 * cheap first pass over the whole candidate pool). "full" takes the better of the title alone and
 * title + abstract: abstracts add methods and numbers that dilute similarity, so scoring only
 * title + abstract would rank papers *without* an abstract above comparable papers with one.
 * The question is embedded in every language it was expressed in (original + translations) and
 * averaged.
 * Waits up to `waitMs` for the model on first use; otherwise returns null with a reason.
 */
export async function semanticScores(
  queryTexts: string[],
  papers: Paper[],
  { field = "full", waitMs = 60_000 }: { field?: SemanticField; waitMs?: number } = {},
): Promise<{ scores: Map<string, number> | null; notice: string | null }> {
  if (!env().EMBEDDINGS_ENABLED) {
    return { scores: null, notice: "Semantic ranking is disabled (EMBEDDINGS_ENABLED=false); results are ranked by keyword match." };
  }
  const extractor =
    state.extractor ??
    (await Promise.race([
      loadEmbeddings(),
      new Promise<null>((r) => setTimeout(() => r(null), waitMs)),
    ]));
  if (!extractor) {
    return {
      scores: null,
      notice:
        state.status === "loading"
          ? "The multilingual embedding model is still loading (first run downloads ~120 MB). Results are ranked by keyword match for now."
          : "The multilingual embedding model could not be loaded, so semantic ranking is unavailable. Results are ranked by keyword match.",
    };
  }

  // Each paper is scored on one or more texts; it keeps the best.
  const textsOf = (p: Paper): string[] =>
    (field === "title" || !p.abstract ? [p.title ?? ""] : [p.title ?? "", paperText(p)])
      .map((t) => t.slice(0, MAX_CHARS))
      .filter(Boolean);
  const scored = papers.map((p) => ({ id: p.id, texts: textsOf(p) })).filter((x) => x.texts.length);
  try {
    const queries = queryTexts.map((q) => q.slice(0, MAX_CHARS));
    const vectors = await embed(extractor, [...queries, ...scored.flatMap((x) => x.texts)]);
    const q = centroid(vectors.slice(0, queries.length));
    const scores = new Map<string, number>();
    let next = queries.length;
    for (const x of scored) {
      const sims = x.texts.map(() => cosine(q, vectors[next++]));
      scores.set(x.id, Math.max(...sims));
    }
    return { scores, notice: null };
  } catch (err) {
    console.error("[embeddings] inference failed:", err instanceof Error ? err.message : err);
    return { scores: null, notice: "Semantic scoring failed for this search; results are ranked by keyword match." };
  }
}
