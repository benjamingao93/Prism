const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Convert metadata that may contain markup (OpenAlex titles with <i>, Crossref JATS abstracts)
 * into plain text. The output is rendered as a React text node, so this is for readability,
 * not the security boundary.
 */
export function toPlainText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/<\/?(jats:)?(p|sec|title|break)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return text.length ? text : null;
}

/** Fraction of letters in Han/Kana/Hangul scripts. */
export function cjkRatio(text: string): number {
  const letters = text.match(/\p{L}/gu);
  if (!letters?.length) return 0;
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
  return (cjk?.length ?? 0) / letters.length;
}
