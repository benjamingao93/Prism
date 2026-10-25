import { cjkRatio } from "./text";
import type { Paper } from "./types";

/** Aggressive normalization used only for exact-equality title matching. */
export function normalizeTitle(title: string | null): string | null {
  if (!title) return null;
  const t = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

function titleKey(p: Paper): string | null {
  const t = normalizeTitle(p.title);
  // Conservative: specific titles only, and year must match, to avoid merging distinct short-titled works.
  // CJK titles carry far more information per character, so they qualify at a shorter length.
  const minLength = cjkRatio(t ?? "") > 0.5 ? 8 : 20;
  if (!t || t.length < minLength || p.year == null) return null;
  return `${p.year}|${t}`;
}

/**
 * Title-only matches must not contradict the author lists, when both records have one.
 * Names written in different scripts (e.g. 磯辺 篤彦 vs. Atsuhiko Isobe) can't be compared, so
 * they don't block a match; the exact title and year still have to agree.
 */
function sameFirstAuthor(a: Paper, b: Paper): boolean {
  if (!a.authors.length || !b.authors.length) return true;
  const [x, y] = [a.authors[0], b.authors[0]];
  if (cjkRatio(x) > 0.5 !== cjkRatio(y) > 0.5) return true;
  return normalizeTitle(x) === normalizeTitle(y);
}

/** Combine two records of the same work. First non-null value wins; provenance is unioned. */
function mergeInto(target: Paper, incoming: Paper): void {
  target.openalexId ??= incoming.openalexId;
  target.doi ??= incoming.doi;
  target.title ??= incoming.title;
  if (!target.authors.length && incoming.authors.length) {
    target.authors = incoming.authors;
    target.authorCount = incoming.authorCount;
  }
  target.year ??= incoming.year;
  target.venue ??= incoming.venue;
  target.abstract ??= incoming.abstract;
  if (target.language == null && incoming.language != null) {
    target.language = incoming.language;
    target.languageTag = incoming.languageTag;
    target.languageSource = incoming.languageSource;
  }
  target.landingUrl ??= incoming.landingUrl;
  target.oaUrl ??= incoming.oaUrl;
  target.isOpenAccess ??= incoming.isOpenAccess;
  target.citedByCount ??= incoming.citedByCount;
  target.type ??= incoming.type;
  for (const s of incoming.sources) if (!target.sources.includes(s)) target.sources.push(s);
  for (const r of incoming.retrievedBy) {
    if (!target.retrievedBy.some((x) => x.variantId === r.variantId)) target.retrievedBy.push(r);
  }
}

/**
 * Merge papers retrieved by different query variants/sources.
 * Match order: normalized DOI → OpenAlex ID → exact normalized title + same year.
 * Input order is preserved for the first occurrence of each work.
 */
export function mergePapers(lists: Paper[][]): Paper[] {
  const out: Paper[] = [];
  const byDoi = new Map<string, Paper>();
  const byOpenAlex = new Map<string, Paper>();
  const byTitle = new Map<string, Paper>();

  for (const list of lists) {
    for (const original of list) {
      const p: Paper = {
        ...original,
        authors: [...original.authors],
        sources: [...original.sources],
        retrievedBy: [...original.retrievedBy],
      };
      const tKey = titleKey(p);
      const titleMatch = tKey ? byTitle.get(tKey) : undefined;
      const existing =
        (p.doi && byDoi.get(p.doi)) ||
        (p.openalexId && byOpenAlex.get(p.openalexId)) ||
        (titleMatch && sameFirstAuthor(titleMatch, p) ? titleMatch : null) ||
        null;

      // Two records with different DOIs are different works, even if titles match.
      const conflictingDoi = existing && existing.doi && p.doi && existing.doi !== p.doi;
      if (existing && !conflictingDoi) {
        mergeInto(existing, p);
        if (existing.doi) byDoi.set(existing.doi, existing);
        if (existing.openalexId) byOpenAlex.set(existing.openalexId, existing);
        continue;
      }

      out.push(p);
      if (p.doi) byDoi.set(p.doi, p);
      if (p.openalexId) byOpenAlex.set(p.openalexId, p);
      if (tKey && !byTitle.has(tKey)) byTitle.set(tKey, p);
    }
  }

  // Keep ids stable: prefer OpenAlex id when a DOI-only record was enriched with one.
  for (const p of out) if (p.openalexId) p.id = p.openalexId;
  return out;
}
