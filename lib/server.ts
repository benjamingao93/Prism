import "server-only";
import { globalCache } from "./cache";
import { searchCrossref, type CrossrefSearchParams } from "./crossref";
import { embeddingModelName, embeddingStatus, semanticScores } from "./embeddings";
import { env, modelChain } from "./env";
import { llmConfigured, structuredCall } from "./llm";
import { searchOpenAlex, type OpenAlexSearchParams, type SearchResult } from "./openalex";
import { expandQuery, ExpansionSchema } from "./query-expansion";
import type { SearchDeps } from "./search";
import { TranslationSchema, translateItems } from "./translation";
import type { Capabilities, TranslateRequest } from "./types";

const DAY = 24 * 60 * 60 * 1000;
// Cache raw source responses: OpenAlex bills keyword searches per request.
const sourceCache = globalCache<SearchResult>("source-responses", 1000, DAY);

function cached(prefix: string, params: object, run: () => Promise<SearchResult>): Promise<SearchResult> {
  const key = `${prefix}:${JSON.stringify(params)}`;
  const hit = sourceCache.get(key);
  if (hit) return Promise.resolve(hit);
  return run().then((result) => {
    sourceCache.set(key, result);
    return result;
  });
}

export function capabilities(): Capabilities {
  const e = env();
  return {
    llm: llmConfigured(),
    embeddings: embeddingStatus(),
    embeddingModel: embeddingModelName(),
    openalexKey: Boolean(e.OPENALEX_API_KEY),
    crossref: e.CROSSREF_ENABLED,
  };
}

export function searchDeps(): SearchDeps {
  const e = env();
  return {
    expand: (query, source, targets) =>
      expandQuery(query, source, targets, {
        model: e.LLM_MODEL_FAST,
        callLlm: llmConfigured()
          ? async (system, prompt) =>
              (
                await structuredCall(ExpansionSchema, {
                  models: modelChain(e.LLM_MODEL_FAST),
                  system,
                  prompt,
                  // Thinking tokens count toward the output budget; 15 languages need headroom.
                  maxTokens: 8000,
                  thinking: "low",
                  timeoutMs: 20_000,
                })
              ).data
          : null,
      }),
    searchOpenAlex: (params: OpenAlexSearchParams) =>
      cached("openalex", params, () =>
        searchOpenAlex(params, { apiKey: e.OPENALEX_API_KEY, mailto: e.OPENALEX_MAILTO }),
      ),
    searchCrossref: e.CROSSREF_ENABLED
      ? (params: CrossrefSearchParams) =>
          cached("crossref", params, () => searchCrossref(params, e.CROSSREF_MAILTO ?? e.OPENALEX_MAILTO))
      : null,
    semantic: (queryTexts, papers) => semanticScores(queryTexts, papers),
    capabilities,
  };
}

/** Translate items; `model` is the model that produced the translations (null if none were needed). */
export async function translate(req: TranslateRequest) {
  const e = env();
  let model: string | null = null;
  const items = await translateItems(req, async (system, prompt) => {
    const result = await structuredCall(TranslationSchema, {
      models: modelChain(e.LLM_MODEL_FAST),
      system,
      prompt,
      maxTokens: 16_000,
      thinking: "low",
      timeoutMs: 30_000,
    });
    model = result.model;
    return result.data;
  });
  return { items, model };
}
