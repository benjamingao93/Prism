import { z } from "zod";
import { cjkRatio } from "./text";
import { detectTextLanguage } from "./translation";
import type { Paper } from "./types";

/**
 * Correcting OpenAlex language tags. OpenAlex detects a work's language automatically and is
 * sometimes wrong (e.g. Chinese-tagged works whose title and abstract are English). A free local
 * detector flags papers whose text disagrees with the tag; Gemini then reads the flagged texts and
 * only its verdict overrides the tag. Nothing is inferred from authors, venues or affiliations.
 */

export const LanguageCheckSchema = z.object({
  items: z.array(z.object({ id: z.string(), language: z.string() })),
});
export type LanguageCheckOutput = z.infer<typeof LanguageCheckSchema>;

/** Returns each id's detected ISO 639-1 code, or "unknown". */
export type LanguageCheckFn = (items: { id: string; text: string }[]) => Promise<Map<string, string>>;

export const LANGUAGE_CHECK_SYSTEM = `You identify the language a piece of scholarly text is written in.
For each item, return the ISO 639-1 code (two lowercase letters) of the language of its text, judging only by the text itself.
If the text is too short, mixed, or you are unsure, return "unknown".`;

const MAX_CHARS = 400;

/**
 * The local detector has no Afrikaans or Swahili model and guesses erratically for them (Dutch,
 * Indonesian, Vietnamese…). For papers with those tags, only a detection of a language it identifies
 * reliably counts as disagreement, which still catches the common case: English text mis-tagged.
 */
const UNMODELLED_TAGS = new Set(["af", "sw"]);
const RELIABLE_DETECTIONS = new Set(["en", "fr", "de", "zh", "ja", "ko", "ru", "ar", "hi"]);

/** Enough text to judge reliably. CJK scripts carry far more per character, so need fewer. */
function longEnough(text: string): boolean {
  return text.length >= (cjkRatio(text) > 0.5 ? 10 : 25);
}

/** The text the check judges: the abstract if there is one, otherwise the title. */
export function languageCheckText(p: Paper): string | null {
  if (p.abstract && longEnough(p.abstract)) return p.abstract.slice(0, MAX_CHARS);
  if (p.title && longEnough(p.title)) return p.title;
  return null;
}

/**
 * True when the local detector says the paper's text (abstract, else title) disagrees with its
 * tag, or the paper has no tag. A title in the tagged language vetoes the check: non-English
 * journals routinely publish an English abstract for an article written in their own language,
 * so a Korean title with an English abstract is still a Korean paper.
 */
export function needsLanguageCheck(p: Paper): boolean {
  const text = languageCheckText(p);
  if (!text) return false;
  const local = detectTextLanguage(text);
  if (!local || local === p.language) return false;
  if (p.language && UNMODELLED_TAGS.has(p.language) && !RELIABLE_DETECTIONS.has(local)) return false;
  if (p.language && p.abstract && p.title && longEnough(p.title) && detectTextLanguage(p.title) === p.language) return false;
  return true;
}

/** Apply confirmed detections. Only valid codes that differ from the tag change anything. */
export function applyLanguageOverrides(papers: Paper[], detected: Map<string, string>): Paper[] {
  return papers.map((p) => {
    const code = detected.get(p.id)?.trim().toLowerCase();
    if (!code || !/^[a-z]{2}$/.test(code) || code === p.language) return p;
    return { ...p, language: code, languageSource: "detected" };
  });
}
