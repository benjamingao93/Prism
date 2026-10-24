import { detect } from "tinyld";
import { z } from "zod";
import { globalCache } from "./cache";
import { languageName } from "./languages";
import { cjkRatio } from "./text";
import type { QueryLanguage, TranslatedItem, TranslateRequest } from "./types";

/**
 * Best-effort guess of the language a piece of *text* is written in. Used only to skip
 * translating text that is already in the reader's language — never to label a paper's
 * publication language, which comes from source metadata.
 */
export function detectTextLanguage(text: string): string | null {
  if (!text.trim()) return null;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (cjkRatio(text) > 0.5 && /\p{Script=Han}/u.test(text)) return "zh";
  if (/\p{Script=Hangul}/u.test(text) && cjkRatio(text) > 0.5) return "ko";
  const guess = detect(text);
  return guess || null;
}

/** Text is treated as already in the target language only when detection is confident enough. */
export function isAlreadyIn(text: string, target: QueryLanguage): boolean {
  const detected = detectTextLanguage(text);
  if (detected !== target) return false;
  // Short Latin-script titles are easy to misdetect between en/es/pt; require more evidence.
  if ((target === "en" || target === "es" || target === "pt") && text.length < 25) return false;
  return true;
}

export const TranslationSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      title_already_in_target: z.boolean(),
      abstract: z.string().nullable(),
      abstract_already_in_target: z.boolean(),
    }),
  ),
});
export type TranslationOutput = z.infer<typeof TranslationSchema>;

export function translationSystemPrompt(target: QueryLanguage): string {
  return `You translate scholarly metadata into ${languageName(target)} for researchers.
Translate faithfully and completely. Preserve technical terms, species names, gene names, chemical formulas, numbers, units, and statistics exactly. Do not summarize, add, explain, or omit information.
If a field is already written in ${languageName(target)}, return it unchanged and set its *_already_in_target flag to true.
If a field is null, return null for it.`;
}

type CacheEntry = { text: string | null; already: boolean };
const cache = globalCache<CacheEntry>("translations", 5000, 7 * 24 * 60 * 60 * 1000);
const ckey = (id: string, field: "title" | "abstract", lang: string, text: string) =>
  `${lang}|${field}|${id}|${text.length}|${text.slice(0, 64)}`;

export type TranslateFn = (system: string, prompt: string) => Promise<TranslationOutput>;

export async function translateItems(req: TranslateRequest, callLlm: TranslateFn): Promise<TranslatedItem[]> {
  const target = req.targetLang;
  const results = new Map<string, TranslatedItem>();
  const pending: { id: string; title: string | null; abstract: string | null }[] = [];

  for (const item of req.items) {
    const out: TranslatedItem = {
      id: item.id,
      title: null,
      abstract: null,
      titleAlreadyInTarget: false,
      abstractAlreadyInTarget: false,
    };
    let needTitle: string | null = null;
    let needAbstract: string | null = null;

    if (item.title) {
      const hit = cache.get(ckey(item.id, "title", target, item.title));
      if (hit) [out.title, out.titleAlreadyInTarget] = [hit.text, hit.already];
      else if (isAlreadyIn(item.title, target)) out.titleAlreadyInTarget = true;
      else needTitle = item.title;
    }
    if (item.abstract) {
      const hit = cache.get(ckey(item.id, "abstract", target, item.abstract));
      if (hit) [out.abstract, out.abstractAlreadyInTarget] = [hit.text, hit.already];
      else if (isAlreadyIn(item.abstract, target)) out.abstractAlreadyInTarget = true;
      else needAbstract = item.abstract;
    }
    results.set(item.id, out);
    if (needTitle || needAbstract) pending.push({ id: item.id, title: needTitle, abstract: needAbstract });
  }

  if (pending.length) {
    const prompt = `Translate each item's fields into ${languageName(target)}. Return every id.\n\n${JSON.stringify({ items: pending })}`;
    const output = await callLlm(translationSystemPrompt(target), prompt);
    const byId = new Map(output.items.map((i) => [i.id, i]));
    for (const p of pending) {
      const got = byId.get(p.id);
      const out = results.get(p.id)!;
      if (!got) continue;
      if (p.title) {
        out.titleAlreadyInTarget = got.title_already_in_target;
        out.title = got.title_already_in_target ? null : (got.title?.trim() || null);
        cache.set(ckey(p.id, "title", target, p.title), { text: out.title, already: out.titleAlreadyInTarget });
      }
      if (p.abstract) {
        out.abstractAlreadyInTarget = got.abstract_already_in_target;
        out.abstract = got.abstract_already_in_target ? null : (got.abstract?.trim() || null);
        cache.set(ckey(p.id, "abstract", target, p.abstract), { text: out.abstract, already: out.abstractAlreadyInTarget });
      }
    }
  }
  return req.items.map((i) => results.get(i.id)!);
}
