import "server-only";
import { createHash } from "node:crypto";
import { globalCache } from "./cache";
import { env } from "./env";
import { cosine, paperText } from "./ranking";
import { cjkRatio } from "./text";
import type { EmbeddingStatus, Paper } from "./types";

type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

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
      state.extractor = pipe as unknown as Extractor;
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

/**
 * The model was trained on sequences of ~128 tokens. Keep roughly that much text
 * (the title plus the opening of the abstract) so long abstracts don't dilute the mean pooling.
 */
export function truncateForEmbedding(text: string): string {
  const budget = cjkRatio(text) > 0.3 ? 220 : 700;
  return text.length > budget ? text.slice(0, budget) : text;
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
    const tensor = await extractor(
      idx.map((i) => texts[i]),
      { pooling: "mean", normalize: true },
    );
    tensor.tolist().forEach((vec, j) => {
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

/**
 * Cosine similarity between the question and each paper's title + abstract. The question is
 * embedded in every language it was expressed in (original + translations) and averaged.
 * Waits up to `waitMs` for the model on first use; otherwise returns null with a reason.
 */
export async function semanticScores(
  queryTexts: string[],
  papers: Paper[],
  { waitMs = 60_000 }: { waitMs?: number } = {},
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

  const withText = papers.filter((p) => paperText(p));
  try {
    const queries = queryTexts.map(truncateForEmbedding);
    const vectors = await embed(extractor, [...queries, ...withText.map((p) => truncateForEmbedding(paperText(p)))]);
    const q = centroid(vectors.slice(0, queries.length));
    const docs = vectors.slice(queries.length);
    const scores = new Map<string, number>();
    withText.forEach((p, i) => scores.set(p.id, cosine(q, docs[i])));
    return { scores, notice: null };
  } catch (err) {
    console.error("[embeddings] inference failed:", err instanceof Error ? err.message : err);
    return { scores: null, notice: "Semantic scoring failed for this search; results are ranked by keyword match." };
  }
}
