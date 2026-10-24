/**
 * Fallback estimate of each language's share of the scholarly literature: OpenAlex works with an
 * abstract published since 2000, by language (measured October 2026 with group_by=language).
 * Used only when the topic-specific count request fails.
 */
export const OPENALEX_WORKS_BY_LANGUAGE: Record<string, number> = {
  en: 112_937_205,
  es: 5_095_045,
  pt: 4_272_895,
  zh: 3_288_367,
  fr: 3_136_136,
  id: 2_899_728,
  de: 2_227_430,
  ru: 1_688_753,
  ko: 1_248_295,
  uk: 890_181,
  ja: 835_902,
  tr: 746_334,
  it: 619_603,
  pl: 470_956,
  ar: 468_060,
};
