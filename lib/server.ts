import "server-only";
import { globalCache } from "./cache";
import { searchCrossref, type CrossrefSearchParams } from "./crossref";
import { embeddingModelName, embeddingStatus, semanticScores } from "./embeddings";
import { env } from "./env";
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
          ? (system, prompt) =>
              structuredCall(ExpansionSchema, { model: e.LLM_MODEL_FAST, system, prompt, maxTokens: 2000, effort: "low", timeoutMs: 20_000 })
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
    semantic: (query, papers) => semanticScores(query, papers),
    capabilities,
  };
}

export function translate(req: TranslateRequest) {
  const e = env();
  return translateItems(req, (system, prompt) =>
    structuredCall(TranslationSchema, {
      model: e.LLM_MODEL_FAST,
      system,
      prompt,
      maxTokens: 16_000,
      effort: "low",
      timeoutMs: 60_000,
    }),
  );
}
