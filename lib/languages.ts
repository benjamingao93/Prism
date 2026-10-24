import type { QueryLanguage } from "./types";

interface LanguageLabel {
  english: string;
  native: string;
}

const LABELS: Record<string, LanguageLabel> = {
  en: { english: "English", native: "English" },
  zh: { english: "Chinese", native: "中文" },
  es: { english: "Spanish", native: "Español" },
  ja: { english: "Japanese", native: "日本語" },
  pt: { english: "Portuguese", native: "Português" },
  fr: { english: "French", native: "Français" },
  de: { english: "German", native: "Deutsch" },
  ko: { english: "Korean", native: "한국어" },
  ru: { english: "Russian", native: "Русский" },
  it: { english: "Italian", native: "Italiano" },
  pl: { english: "Polish", native: "Polski" },
  tr: { english: "Turkish", native: "Türkçe" },
  id: { english: "Indonesian", native: "Bahasa Indonesia" },
  ar: { english: "Arabic", native: "العربية" },
  fa: { english: "Persian", native: "فارسی" },
  uk: { english: "Ukrainian", native: "Українська" },
  nl: { english: "Dutch", native: "Nederlands" },
  cs: { english: "Czech", native: "Čeština" },
  hr: { english: "Croatian", native: "Hrvatski" },
  sv: { english: "Swedish", native: "Svenska" },
  hu: { english: "Hungarian", native: "Magyar" },
  vi: { english: "Vietnamese", native: "Tiếng Việt" },
  th: { english: "Thai", native: "ไทย" },
  hi: { english: "Hindi", native: "हिन्दी" },
};

export const QUERY_LANGUAGE_OPTIONS: { code: QueryLanguage; label: string; native: string }[] = (
  ["en", "zh", "es", "ja", "pt"] as const
).map((code) => ({ code, label: LABELS[code].english, native: LABELS[code].native }));

/** English name for a language code, falling back to Intl.DisplayNames, then the raw code. */
export function languageName(code: string | null | undefined): string {
  if (!code) return "Language unavailable";
  const known = LABELS[code];
  if (known) return known.english;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    if (name && name !== code) return name;
  } catch {
    // invalid code — fall through
  }
  return code.toUpperCase();
}

/** "Chinese · 中文", "English", or "Language unavailable". */
export function languageLabel(code: string | null | undefined): string {
  if (!code) return "Language unavailable";
  const english = languageName(code);
  const native = LABELS[code]?.native;
  return native && native !== english ? `${english} · ${native}` : english;
}
