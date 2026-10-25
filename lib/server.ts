import "server-only";
import { globalCache } from "./cache";
import { searchCrossref, type CrossrefSearchParams } from "./crossref";
import { embeddingModelName, embeddingStatus, semanticScores } from "./embeddings";
import { env, modelChain } from "./env";
import { llmConfigured, structuredCall } from "./llm";
import { countWorksByLanguage, fetchSourceCountries, searchOpenAlex, type OpenAlexSearchParams, type SearchResult } from "./openalex";
import { expandQuery, ExpansionSchema } from "./query-expansion";
import type { SearchDeps } from "./search";
import { TranslationSchema, translateItems } from "./translation";
import { LANGUAGE_CHECK_SYSTEM, LanguageCheckSchema } from "./language-check";
import type { Capabilities, TranslateRequest } from "./types";

const DAY = 24 * 60 * 60 * 1000;
// Cache raw source responses: OpenAlex bills keyword searches per request.
const sourceCache = globalCache<SearchResult>("source-responses", 1000, DAY);
const countCache = globalCache<Record<string, number>>("language-counts", 1000, DAY);
const languageCache = globalCache<string>("language-checks", 20_000, 7 * DAY);
// Venue countries rarely change; "" records a known absence.
const sourceCountryCache = globalCache<string>("source-countries", 50_000, 30 * DAY);

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
                  // Thinking tokens count toward the output budget; 18 languages need headroom.
                  maxTokens: 10000,
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
    sourceCountries: async (ids) => {
      const out = new Map<string, string | null>();
      const missing: string[] = [];
      for (const id of new Set(ids)) {
        const hit = sourceCountryCache.get(id);
        if (hit === undefined) missing.push(id);
        else out.set(id, hit || null);
      }
      if (missing.length) {
        const fetched = await fetchSourceCountries(missing, { apiKey: e.OPENALEX_API_KEY, mailto: e.OPENALEX_MAILTO });
        for (const [id, cc] of fetched) {
          out.set(id, cc);
          sourceCountryCache.set(id, cc ?? "");
        }
      }
      return out;
    },
    checkLanguages: llmConfigured()
      ? async (items) => {
          const result = new Map<string, string>();
          const pending = items.filter((i) => {
            const hit = languageCache.get(`${i.id}|${i.text.length}`);
            if (hit) result.set(i.id, hit);
            return !hit;
          });
          if (pending.length) {
            const { data } = await structuredCall(LanguageCheckSchema, {
              models: modelChain(e.LLM_MODEL_FAST),
              system: LANGUAGE_CHECK_SYSTEM,
              prompt: JSON.stringify({ items: pending }),
              maxTokens: 4000,
              thinking: "low",
              timeoutMs: 15_000,
            });
            for (const item of data.items) {
              result.set(item.id, item.language);
              const text = pending.find((p) => p.id === item.id)?.text;
              if (text) languageCache.set(`${item.id}|${text.length}`, item.language);
            }
          }
          return result;
        }
      : null,
    countByLanguage: (params) => {
      const key = `openalex-count:${JSON.stringify(params)}`;
      const hit = countCache.get(key);
      if (hit) return Promise.resolve(hit);
      return countWorksByLanguage(params, { apiKey: e.OPENALEX_API_KEY, mailto: e.OPENALEX_MAILTO }).then((counts) => {
        countCache.set(key, counts);
        return counts;
      });
    },
    searchCrossref: e.CROSSREF_ENABLED
      ? (params: CrossrefSearchParams) =>
          cached("crossref", params, () => searchCrossref(params, e.CROSSREF_MAILTO ?? e.OPENALEX_MAILTO))
      : null,
    semantic: (queryTexts, papers, field) => semanticScores(queryTexts, papers, { field }),
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
