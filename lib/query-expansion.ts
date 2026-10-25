import { z } from "zod";
import { globalCache } from "./cache";
import { languageName } from "./languages";
import { extractKeywords } from "./tokenize";
import { QUERY_LANGUAGES, type QueryLanguage } from "./types";

export interface PlannedVariant {
  lang: QueryLanguage;
  kind: "original" | "translated";
  text: string;
  /** Core concepts, most essential first; each may be several words ("contaminación del aire"). */
  concepts: string[];
  /** The question's most distinctive subject term in this language, used to size its literature. */
  topic: string;
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
      keywords: z.array(z.string()),
      topic: z.string(),
    }),
  ),
});
export type ExpansionOutput = z.infer<typeof ExpansionSchema>;

const SYSTEM = `You help researchers search scholarly databases (OpenAlex) across languages.
Given a research question, produce for each requested language:
- "translation": a faithful natural-language translation of the question. For the question's own language, repeat the question unchanged.
- "keywords": an array of 2–5 core concepts as they would appear in titles and abstracts of scientific papers written in that language, ordered from most to least essential. Each concept is one array item and may be a multi-word term (for example "air pollution" or "contaminación del aire"); never split one concept across items. Use the standard technical terminology of that language's literature. No boolean operators, quotes, or punctuation. For Chinese and Japanese, prefer short, common terms of 2–4 characters and split long compounds into separate items (海洋, 生态 rather than 海洋生态系统), because the search index only matches whole terms. Write Hindi in Devanagari.
Produce the same concepts, in the same order, for every language.
- "topic": the question's main object of study as one short, common term in that language: the thing being studied, such as "asthma", "acupuncture", "rice", "microplastics" or "Shakespeare". Not a modifier, method, process or generic word (not "drought-resistant", "adaptation", "effects", "city" or "children"). Use the everyday term researchers in that language would write, as one whole word or phrase; never split it, including in Chinese and Japanese. Use the same concept in every language.
Do not add concepts that are not in the question. Do not answer the question.`;

export function buildExpansionPrompt(query: string, source: QueryLanguage, targets: QueryLanguage[]): string {
  const langs = [source, ...targets].map((l) => `${l} (${languageName(l)})`).join(", ");
  return `Question language: ${source} (${languageName(source)})\nLanguages to produce: ${langs}\n\nResearch question:\n${query}`;
}

const MAX_CONCEPTS = 5;
const MAX_CONCEPT_CHARS = 60;

function cleanConcepts(raw: string[]): string[] {
  const out = raw
    .map((c) =>
      c
        .replace(/["“”()]/g, " ")
        .replace(/\b(AND|OR|NOT)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_CONCEPT_CHARS),
    )
    .filter(Boolean);
  return [...new Set(out)].slice(0, MAX_CONCEPTS);
}

/** Concepts from plain text when no LLM is available: each content word is a concept. */
export function conceptsFromQuery(query: string): string[] {
  return extractKeywords(query).split(" ").filter(Boolean);
}

/** Turn LLM output into a validated variant plan; the original query is always first. */
export function planFromExpansion(
  query: string,
  source: QueryLanguage,
  targets: QueryLanguage[],
  output: ExpansionOutput,
): PlannedVariant[] {
  const byLang = new Map(output.variants.map((v) => [v.lang, v]));
  const originalConcepts = cleanConcepts(byLang.get(source)?.keywords ?? []);
  const concepts0 = originalConcepts.length ? originalConcepts : conceptsFromQuery(query);
  const topicOf = (raw: string | undefined, fallback: string) => cleanConcepts([raw ?? ""])[0] ?? fallback;
  const plan: PlannedVariant[] = [
    { lang: source, kind: "original", text: query, concepts: concepts0, topic: topicOf(byLang.get(source)?.topic, concepts0[0]) },
  ];
  for (const lang of targets) {
    if (lang === source) continue;
    const v = byLang.get(lang);
    const concepts = v ? cleanConcepts(v.keywords) : [];
    const translation = v?.translation.trim() ?? "";
    if (!concepts.length || !translation) continue;
    plan.push({ lang, kind: "translated", text: translation.slice(0, 500), concepts, topic: topicOf(v?.topic, concepts[0]) });
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
    variants: [{ lang: source, kind: "original", text: query, concepts: conceptsFromQuery(query), topic: conceptsFromQuery(query)[0] ?? query }],
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
