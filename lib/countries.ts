import { numericToAlpha2 } from "i18n-iso-countries";

/** English country name for an ISO 3166-1 alpha-2 code ("JP" → "Japan"). */
export function countryName(code: string | null | undefined): string {
  if (!code) return "Country unavailable";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** ISO alpha-2 code for a numeric ISO 3166-1 id (as used by world-atlas), or null. */
export function alpha2FromNumeric(id: string | number | undefined): string | null {
  if (id === undefined || id === null) return null;
  const code = numericToAlpha2(String(id).padStart(3, "0"));
  return code ?? null;
}

export interface CountryCount {
  code: string;
  count: number;
}

/** Papers per venue country, most first; papers with no recorded country are counted separately. */
export function countByCountry(papers: { country: string | null }[]): { countries: CountryCount[]; unknown: number } {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const p of papers) {
    if (p.country) counts.set(p.country, (counts.get(p.country) ?? 0) + 1);
    else unknown++;
  }
  const countries = [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { countries, unknown };
}
