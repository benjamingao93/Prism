import { z } from "zod";
import { globalCache } from "./cache";
import { languageName } from "./languages";
import { extractKeywords } from "./tokenize";
import { QUERY_LANGUAGES, type QueryLanguage } from "./types";

export interface PlannedVariant {
  lang: QueryLanguage;
  kind: "original" | "translated";
  text: string;
  searchQuery: string;
}

export interface ExpansionResult {
  variants: PlannedVariant[];
  /** Set when cross-language expansion did not happen, explaining why. */
  notice: string | null;
  model: string | null;
}

export const ExpansionSchema = z.object({
  variants: z.array(
    z.object({
      lang: z.enum(QUERY_LANGUAGES),
      translation: z.string(),
      keywords: z.string(),
    }),
  ),
});
export type ExpansionOutput = z.infer<typeof ExpansionSchema>;

const SYSTEM = `You help researchers search scholarly databases (OpenAlex) across languages.
Given a research question, produce for each requested language:
- "translation": a faithful natural-language translation of the question. For the question's own language, repeat the question unchanged.
- "keywords": 2–5 core concepts as they would appear in titles and abstracts of scientific papers written in that language, separated by single spaces and ordered from most to least essential. Use the standard technical terminology of that language's literature. No boolean operators, quotes, or punctuation. For Chinese and Japanese, separate terms with spaces and prefer short, common terms of 2–4 characters: split long compounds (write 海洋 生态 rather than 海洋生态系统), because the search index only matches whole terms.
Do not add concepts that are not in the question. Do not answer the question.`;

export function buildExpansionPrompt(query: string, source: QueryLanguage, targets: QueryLanguage[]): string {
  const langs = [source, ...targets].map((l) => `${l} (${languageName(l)})`).join(", ");
  return `Question language: ${source} (${languageName(source)})\nLanguages to produce: ${langs}\n\nResearch question:\n${query}`;
}

const MAX_KEYWORD_CHARS = 120;

function cleanKeywords(raw: string): string {
  return raw
    .replace(/["“”()]/g, " ")
    .replace(/\b(AND|OR|NOT)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_KEYWORD_CHARS);
}

/** Turn LLM output into a validated variant plan; the original query is always first. */
export function planFromExpansion(
  query: string,
  source: QueryLanguage,
  targets: QueryLanguage[],
  output: ExpansionOutput,
): PlannedVariant[] {
  const byLang = new Map(output.variants.map((v) => [v.lang, v]));
  const originalKeywords = cleanKeywords(byLang.get(source)?.keywords ?? "") || extractKeywords(query);
  const plan: PlannedVariant[] = [{ lang: source, kind: "original", text: query, searchQuery: originalKeywords }];
  for (const lang of targets) {
    if (lang === source) continue;
    const v = byLang.get(lang);
    const keywords = v ? cleanKeywords(v.keywords) : "";
    const translation = v?.translation.trim() ?? "";
    if (!keywords || !translation) continue;
    plan.push({ lang, kind: "translated", text: translation.slice(0, 500), searchQuery: keywords });
  }
  return plan;
}

export interface ExpandDeps {
  /** Calls the LLM; null when no LLM is configured. */
  callLlm: ((system: string, prompt: string) => Promise<ExpansionOutput>) | null;
  model: string | null;
}

const cache = globalCache<PlannedVariant[]>("expansion", 500, 24 * 60 * 60 * 1000);

export async function expandQuery(
  query: string,
  source: QueryLanguage,
  targets: QueryLanguage[],
  deps: ExpandDeps,
): Promise<ExpansionResult> {
  const fallback = (notice: string): ExpansionResult => ({
    variants: [{ lang: source, kind: "original", text: query, searchQuery: extractKeywords(query) }],
    notice,
    model: null,
  });
  const realTargets = targets.filter((t) => t !== source);
  if (!realTargets.length) return { ...fallback(""), notice: null };

  if (!deps.callLlm) {
    return fallback(
      "Cross-language query expansion is unavailable (no LLM configured), so only your original query was searched. Coverage of papers in other languages is reduced.",
    );
  }

  const key = JSON.stringify([query.trim().toLowerCase(), source, [...realTargets].sort()]);
  const hit = cache.get(key);
  if (hit) return { variants: hit, notice: null, model: deps.model };

  try {
    const output = await deps.callLlm(SYSTEM, buildExpansionPrompt(query, source, realTargets));
    const variants = planFromExpansion(query, source, realTargets, output);
    cache.set(key, variants);
    const missing = realTargets.filter((t) => !variants.some((v) => v.lang === t));
    return {
      variants,
      notice: missing.length ? `No usable translation was produced for: ${missing.map(languageName).join(", ")}.` : null,
      model: deps.model,
    };
  } catch {
    return fallback(
      "Cross-language query expansion failed for this search, so only your original query was searched. Coverage of papers in other languages is reduced.",
    );
  }
}

export const EXPANSION_SYSTEM_PROMPT = SYSTEM;
