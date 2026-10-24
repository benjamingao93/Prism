// Language-aware tokenization for BM25. Intl.Segmenter uses ICU word-break rules, which
// include dictionary-based segmentation for Chinese and Japanese, so CJK text yields
// real words rather than single characters or whole sentences.

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

const STOPWORDS = new Set(
  [
    // English
    "a an the and or of in on for to from by with without at as is are was were be been being this that these those it its into about over under between than then how what which who whom why when where does do did done can could should would may might will shall effect effects affect affects affecting using use used based study studies analysis role impact new via among",
    // Spanish
    "el la los las un una unos unas y o de del en con sin por para como es son fue ser al que qué cómo cual cuál cuales sobre entre efecto efectos estudio",
    // Portuguese
    "o a os as um uma e ou de do da dos das em no na nos nas com sem por para como é são foi ser ao que qual quais sobre entre efeito efeitos estudo",
    // French / German / Italian / Indonesian articles and particles
    "le les des du une et ou dans sur pour par avec sans est sont au aux der die das den dem des ein eine einer und oder mit für von zu im ist sind il lo gli della delle degli nel nella per con dan yang di ke dari untuk dengan pada dalam terhadap pengaruh",
    // Chinese / Japanese function words that ICU emits as words
    "的 了 和 与 及 对 在 是 中 等 如何 怎样 什么 哪些 影响 研究 の は が を に で と も へ や から まで について における による する した される こと ため 影響 研究",
  ]
    .join(" ")
    .split(/\s+/),
);

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Very light, language-neutral plural folding for alphabetic scripts. */
function fold(token: string): string {
  if (CJK.test(token)) return token;
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string | null | undefined, opts: { keepStopwords?: boolean } = {}): string[] {
  if (!text) return [];
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [];
  for (const seg of segmenter.segment(normalized)) {
    if (!seg.isWordLike) continue;
    const word = seg.segment;
    if (!opts.keepStopwords && STOPWORDS.has(word)) continue;
    // Drop bare numbers and single Latin letters; single CJK characters can be meaningful (e.g. 稻).
    if (/^\d+$/.test(word) || (!CJK.test(word) && word.length < 2)) continue;
    tokens.push(fold(word));
  }
  return tokens;
}

/** Fallback keyword extraction when no LLM is available: content words of the query, in order. */
export function extractKeywords(query: string, max = 6): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const normalized = query.normalize("NFKC");
  for (const seg of segmenter.segment(normalized)) {
    if (!seg.isWordLike) continue;
    const lower = seg.segment.toLowerCase();
    if (STOPWORDS.has(lower) || (!CJK.test(lower) && lower.length < 2) || seen.has(lower)) continue;
    seen.add(lower);
    out.push(seg.segment);
    if (out.length >= max) break;
  }
  return out.length ? out.join(" ") : query.trim();
}
