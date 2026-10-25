import { z } from "zod";
import { languageName } from "./languages";
import { QUERY_LANGUAGES, type Paper, type SearchResponse } from "./types";

/**
 * Language gaps: which themes each language's research on a question emphasizes or leaves out.
 *
 * Each language's most relevant papers are sampled; Gemini names the themes they discuss and tags
 * every paper with the themes its own title or abstract covers. Everything numeric (how many of a
 * language's papers touch a theme, and how that compares across languages) is computed here from
 * those tags, and every finding links back to the papers behind it.
 */

/** Papers sampled per language, most relevant first. */
export const GAP_SAMPLE_PER_LANGUAGE = 15;
/** Languages with fewer sampled papers than this are listed but not compared. */
export const GAP_MIN_PAPERS = 3;
/** A highlighted difference needs at least this many papers on the side that covers the theme… */
export const GAP_MIN_COUNT = 2;
/** …and a difference in share of at least this much. */
export const GAP_MIN_DIFF = 0.25;
const MAX_ABSTRACT_CHARS = 600;

export const GapsRequestSchema = z.object({
  query: z.string().trim().min(2).max(500),
  queryLanguage: z.enum(QUERY_LANGUAGES),
  publicationLanguages: z.array(z.string().regex(/^[a-z]{2}$/)).max(20).default([]),
  yearFrom: z.number().int().min(1800).max(2100).nullable().default(null),
  yearTo: z.number().int().min(1800).max(2100).nullable().default(null),
  /** Page size of the search, so its cached OpenAlex responses are reused. */
  limit: z.number().int().min(1).max(100),
  /** The query variants the search ran (from its response), one OpenAlex request each. */
  variants: z
    .array(
      z.object({
        lang: z.string().regex(/^[a-z]{2}$/),
        kind: z.enum(["original", "translated"]),
        text: z.string().max(1000),
        searchQuery: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(QUERY_LANGUAGES.length + 1),
});
export type GapsRequest = z.infer<typeof GapsRequestSchema>;

/** The analysis request for a search: its filters and the queries it ran that returned papers. */
export function gapsRequestFor(response: SearchResponse): GapsRequest {
  return {
    query: response.query,
    queryLanguage: response.queryLanguage,
    publicationLanguages: response.filters.publicationLanguages,
    yearFrom: response.filters.yearFrom,
    yearTo: response.filters.yearTo,
    limit: response.filters.limit,
    variants: response.variants
      .filter((v) => v.source === "openalex" && !v.skipped && !v.error && v.hitCount > 0)
      .map((v) => ({ lang: v.lang, kind: v.kind, text: v.text, searchQuery: v.searchQuery })),
  };
}

export interface GapPaper {
  id: string;
  title: string | null;
  language: string;
  year: number | null;
  venue: string | null;
  url: string | null;
}

export interface GapTheme {
  id: string;
  label: string;
  description: string;
  /** Ids of the sampled papers, per language, whose title or abstract discusses this theme. */
  papers: Record<string, string[]>;
}

export interface GapsResponse {
  query: string;
  queryLanguage: string;
  model: string | null;
  /** Compared languages and how many on-topic papers were sampled from each, largest first. */
  languages: { code: string; total: number }[];
  /** Languages with some on-topic papers, but too few to compare. */
  excluded: { code: string; total: number }[];
  /** Sampled papers the model judged not to be about the question, per language. They count nowhere. */
  offTopic: { code: string; count: number }[];
  themes: GapTheme[];
  papers: GapPaper[];
  /**
   * Gemini's short summary, written from the differences Prism computed against the default
   * baseline (not from the papers), so it can't contradict them. Labeled as AI-written in the UI.
   */
  overview: string | null;
  notices: string[];
  tookMs: number;
}

/** One language's coverage of a theme. */
export interface ThemeShare {
  count: number;
  total: number;
  share: number;
}

export function themeShare(theme: GapTheme, lang: { code: string; total: number }): ThemeShare {
  const count = theme.papers[lang.code]?.length ?? 0;
  return { count, total: lang.total, share: lang.total ? count / lang.total : 0 };
}

export interface GapHighlight {
  theme: GapTheme;
  language: string;
  /** "more": the language covers the theme more than the baseline; "less": the baseline covers it more. */
  direction: "more" | "less";
  here: ThemeShare;
  baseline: ThemeShare;
  diff: number;
}

/** English when it was compared, otherwise the language with the most papers. */
export function defaultBaseline(languages: { code: string; total: number }[]): string | null {
  return languages.find((l) => l.code === "en")?.code ?? languages[0]?.code ?? null;
}

/**
 * Differences against a baseline language that are large enough to point out: a theme that at
 * least GAP_MIN_COUNT papers on one side discuss, with shares at least GAP_MIN_DIFF apart.
 * Strongest differences first.
 */
export function computeHighlights(res: Pick<GapsResponse, "languages" | "themes">, baselineCode: string): GapHighlight[] {
  const baseLang = res.languages.find((l) => l.code === baselineCode);
  if (!baseLang) return [];
  const out: GapHighlight[] = [];
  for (const lang of res.languages) {
    if (lang.code === baselineCode) continue;
    for (const theme of res.themes) {
      const here = themeShare(theme, lang);
      const baseline = themeShare(theme, baseLang);
      const diff = here.share - baseline.share;
      if (diff >= GAP_MIN_DIFF && here.count >= GAP_MIN_COUNT) {
        out.push({ theme, language: lang.code, direction: "more", here, baseline, diff });
      } else if (-diff >= GAP_MIN_DIFF && baseline.count >= GAP_MIN_COUNT) {
        out.push({ theme, language: lang.code, direction: "less", here, baseline, diff: -diff });
      }
    }
  }
  return out.sort((a, b) => b.diff - a.diff);
}

/** Each language's most relevant papers (by score, else retrieval order), and which languages have enough. */
export function sampleByLanguage(
  papers: Paper[],
  scores: Map<string, number> | null,
  perLanguage = GAP_SAMPLE_PER_LANGUAGE,
  minPapers = GAP_MIN_PAPERS,
): { groups: Map<string, Paper[]>; excluded: { code: string; total: number }[] } {
  const byLang = new Map<string, Paper[]>();
  for (const p of papers) {
    if (!p.language || !(p.title || p.abstract)) continue;
    const list = byLang.get(p.language) ?? [];
    list.push(p);
    byLang.set(p.language, list);
  }
  const groups = new Map<string, Paper[]>();
  const excluded: { code: string; total: number }[] = [];
  for (const [code, list] of byLang) {
    const ranked = scores ? [...list].sort((a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1)) : list;
    const sample = ranked.slice(0, perLanguage);
    if (sample.length >= minPapers) groups.set(code, sample);
    else excluded.push({ code, total: sample.length });
  }
  return { groups, excluded: excluded.sort((a, b) => b.total - a.total) };
}

export const GapThemesSchema = z.object({
  themes: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
  assignments: z.array(z.object({ paper: z.string(), themes: z.array(z.string()) })),
  off_topic: z.array(z.string()),
});
export type GapThemesOutput = z.infer<typeof GapThemesSchema>;

export function gapsSystemPrompt(uiLanguage: string): string {
  const lang = languageName(uiLanguage);
  return `You compare research literatures written in different languages. You receive papers retrieved for one research question, grouped by publication language, each with an id, title and (often) abstract.

1. "off_topic": the ids of papers that are not about the research question's subject at all, judged from their own text (for example, a search for the Ganges river can match papers about an unrelated word such as "gang"). Papers on any aspect of the subject are on topic.
2. "themes": identify 6 to 12 themes that the on-topic papers discuss: specific aspects, concepts, methods, settings, populations or perspectives (for a question about the Ganges, themes might be "heavy-metal contamination", "religious and cultural significance" or "sewage treatment policy"). Themes must be specific enough to tell papers apart: not the question's subject itself and not generic words like "research" or "analysis". Include themes that distinguish the languages as well as themes they share. Give each an id (T1, T2, …), a label of 2 to 6 words and a one-sentence description, written in ${lang}.
3. "assignments": for every on-topic paper, list the ids of all themes its title or abstract clearly discusses (possibly none). Judge only from the text given, never from the language, authors or venue, and use the paper ids exactly as given.`;
}

/**
 * Remove the papers the model judged off-topic. Languages left with fewer than `minPapers` move to
 * the excluded list.
 */
export function dropOffTopic(
  groups: Map<string, Paper[]>,
  ids: Map<string, string>,
  offTopicIds: string[],
  minPapers = GAP_MIN_PAPERS,
): { groups: Map<string, Paper[]>; excluded: { code: string; total: number }[]; offTopic: { code: string; count: number }[] } {
  const off = new Set(offTopicIds.map((s) => ids.get(s.trim())).filter((id): id is string => Boolean(id)));
  const kept = new Map<string, Paper[]>();
  const excluded: { code: string; total: number }[] = [];
  const offTopic: { code: string; count: number }[] = [];
  for (const [code, papers] of groups) {
    const onTopic = papers.filter((p) => !off.has(p.id));
    if (onTopic.length < papers.length) offTopic.push({ code, count: papers.length - onTopic.length });
    if (onTopic.length >= minPapers) kept.set(code, onTopic);
    else if (onTopic.length) excluded.push({ code, total: onTopic.length });
  }
  return { groups: kept, excluded, offTopic: offTopic.sort((a, b) => b.count - a.count) };
}

export const GapOverviewSchema = z.object({ overview: z.string() });

export function overviewSystemPrompt(uiLanguage: string): string {
  return `You summarize computed differences between research written in different languages. Write two or three plain sentences in ${languageName(uiLanguage)} describing the most notable differences in the facts given. Use only those facts; you may quote their counts (such as "6 of 15"). Do not explain causes, add outside knowledge, name papers, or generalize beyond these samples.`;
}

/** The strongest computed differences, as plain facts for the overview. */
export function buildOverviewPrompt(query: string, highlights: GapHighlight[], baseline: string, max = 8): string {
  const facts = highlights.slice(0, max).map((h) => {
    const verb = h.direction === "more" ? "more often" : "less often";
    return `- ${languageName(h.language)} papers discuss "${h.theme.label}" ${verb} than ${languageName(baseline)} papers: ${h.here.count} of ${h.here.total} vs ${h.baseline.count} of ${h.baseline.total}.`;
  });
  return `Research question: ${query}\nSamples: the most relevant papers in each language, compared with ${languageName(baseline)}.\n\nFacts:\n${facts.join("\n")}`;
}

/** The papers, grouped by language, with short ids (P1, P2, …) to keep the prompt compact. */
export function buildGapsPrompt(query: string, groups: Map<string, Paper[]>): { prompt: string; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const sections: string[] = [];
  for (const [code, papers] of groups) {
    const lines = papers.map((p) => {
      const short = `P${ids.size + 1}`;
      ids.set(short, p.id);
      const abstract = p.abstract ? ` | Abstract: ${p.abstract.slice(0, MAX_ABSTRACT_CHARS)}${p.abstract.length > MAX_ABSTRACT_CHARS ? "…" : ""}` : "";
      return `[${short}] Title: ${p.title ?? "(none)"}${abstract}`;
    });
    sections.push(`## ${languageName(code)} (${code}): ${papers.length} papers\n${lines.join("\n")}`);
  }
  return { prompt: `Research question: ${query}\n\n${sections.join("\n\n")}`, ids };
}

/**
 * Turn the model's themes and tags into per-language evidence. Only known paper ids and theme ids
 * count, and only for papers in `groups` (off-topic ones are already removed); themes no paper was
 * tagged with are dropped.
 */
export function assembleThemes(out: GapThemesOutput, ids: Map<string, string>, groups: Map<string, Paper[]>): GapTheme[] {
  const languageOf = new Map<string, string>();
  for (const [code, papers] of groups) for (const p of papers) languageOf.set(p.id, code);

  const themes = new Map<string, GapTheme>();
  for (const t of out.themes) {
    const label = t.label.trim();
    if (!label || themes.has(t.id)) continue;
    themes.set(t.id, { id: t.id, label, description: t.description.trim(), papers: {} });
  }
  const seen = new Set<string>();
  for (const a of out.assignments) {
    const paperId = ids.get(a.paper.trim());
    const lang = paperId ? languageOf.get(paperId) : undefined;
    if (!paperId || !lang || seen.has(paperId)) continue;
    seen.add(paperId);
    for (const tid of new Set(a.themes.map((t) => t.trim()))) {
      const theme = themes.get(tid);
      if (!theme) continue;
      (theme.papers[lang] ??= []).push(paperId);
    }
  }
  return [...themes.values()].filter((t) => Object.keys(t.papers).length > 0);
}
