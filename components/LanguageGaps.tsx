"use client";

import { ArrowLeft, ChevronDown, ExternalLink, Loader2, Scale, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientApiError, api } from "@/lib/client-api";
import {
  computeHighlights,
  defaultBaseline,
  GAP_MIN_COUNT,
  GAP_MIN_DIFF,
  GAP_MIN_PAPERS,
  GAP_SAMPLE_PER_LANGUAGE,
  themeShare,
  type GapHighlight,
  type GapPaper,
  gapsRequestFor,
  type GapsRequest,
  type GapsResponse,
  type GapTheme,
} from "@/lib/gaps";
import { languageName } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { useAppState } from "./AppState";
import { LanguageBadge } from "./LanguageBadge";
import { ErrorState } from "./SearchStates";
import { Notice } from "./StatusNotice";

/** Analyses already run in this tab, so switching pages doesn't redo (or re-bill) them. */
const analysisCache = new Map<string, GapsResponse>();

const pct = (share: number) => `${Math.round(share * 100)}%`;

function cellFill(share: number): string {
  if (share <= 0) return "transparent";
  return `color-mix(in oklch, var(--accent-brand) ${Math.round(12 + 70 * share)}%, var(--surface))`;
}

/** The papers behind a finding, original titles first, translated titles beneath when they help. */
function EvidenceList({ papers, targetLang }: { papers: GapPaper[]; targetLang: string }) {
  const [translated, setTranslated] = useState<Record<string, string>>({});
  useEffect(() => {
    const items = papers.filter((p) => p.title && p.language !== targetLang).slice(0, 30);
    if (!items.length) return;
    let cancelled = false;
    api
      .translate({ targetLang: targetLang as GapsRequest["queryLanguage"], items: items.map((p) => ({ id: p.id, title: p.title, abstract: null })) })
      .then((res) => {
        if (cancelled) return;
        const out: Record<string, string> = {};
        for (const item of res.items) if (item.title && !item.titleAlreadyInTarget) out[item.id] = item.title;
        setTranslated(out);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [papers, targetLang]);

  if (!papers.length) return <p className="text-xs text-muted-foreground">No sampled papers.</p>;
  return (
    <ul className="space-y-2">
      {papers.map((p) => (
        <li key={p.id} className="text-sm leading-snug">
          <div className="flex items-start gap-2">
            <LanguageBadge code={p.language} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-serif hover:text-accent-brand hover:underline" lang={p.language}>
                  {p.title ?? "Untitled record"}
                  <ExternalLink className="ml-1 inline size-3 align-baseline opacity-60" aria-hidden="true" />
                </a>
              ) : (
                <span className="font-serif" lang={p.language}>
                  {p.title ?? "Untitled record"}
                </span>
              )}
              {translated[p.id] && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="mr-1 rounded bg-secondary px-1 text-[10px] tracking-wide uppercase">Machine-translated</span>
                  {translated[p.id]}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{[p.year, p.venue].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ShareBar({ label, share, count, total, strong }: { label: string; share: number; count: number; total: number; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-xs">
      <span className={cn("truncate", strong ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <span className={cn("block h-full rounded-full", strong ? "bg-accent-brand" : "bg-muted-foreground/50")} style={{ width: `${share * 100}%` }} />
      </span>
      <span className="tabular w-24 text-right text-muted-foreground">
        {count} of {total} ({pct(share)})
      </span>
    </div>
  );
}

function HighlightItem({ h, baseline, byId, targetLang }: { h: GapHighlight; baseline: string; byId: Map<string, GapPaper>; targetLang: string }) {
  const [open, setOpen] = useState(false);
  const papers = useMemo(() => {
    const ids = [...(h.theme.papers[h.language] ?? []), ...(h.theme.papers[baseline] ?? [])];
    return ids.map((id) => byId.get(id)).filter((p): p is GapPaper => Boolean(p));
  }, [h, baseline, byId]);
  return (
    <li className="rounded-md border bg-background/40 p-3">
      <p className="text-sm font-medium">{h.theme.label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{h.theme.description}</p>
      <div className="mt-2 space-y-1">
        <ShareBar label={languageName(h.language)} strong {...h.here} />
        <ShareBar label={languageName(baseline)} {...h.baseline} />
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-xs text-accent-brand hover:underline"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        {open ? "Hide" : "Show"} the {papers.length} {papers.length === 1 ? "paper" : "papers"} behind this
      </button>
      {open && (
        <div className="mt-2 border-t pt-2">
          <EvidenceList papers={papers} targetLang={targetLang} />
        </div>
      )}
    </li>
  );
}

function LanguageCard({
  code,
  total,
  baseline,
  highlights,
  byId,
  targetLang,
}: {
  code: string;
  total: number;
  baseline: string;
  highlights: GapHighlight[];
  byId: Map<string, GapPaper>;
  targetLang: string;
}) {
  const more = highlights.filter((h) => h.direction === "more");
  const less = highlights.filter((h) => h.direction === "less");
  return (
    <section className="rounded-lg border bg-surface p-4" aria-label={`${languageName(code)} compared with ${languageName(baseline)}`}>
      <div className="mb-3 flex items-center gap-2">
        <LanguageBadge code={code} />
        <span className="tabular text-xs text-muted-foreground">{total} relevant papers</span>
      </div>
      {!more.length && !less.length ? (
        <p className="text-sm text-muted-foreground">No large differences from {languageName(baseline)} in these samples.</p>
      ) : (
        <div className="space-y-4">
          {more.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Discussed more than in {languageName(baseline)}
              </h3>
              <ul className="space-y-2">
                {more.map((h) => (
                  <HighlightItem key={h.theme.id} h={h} baseline={baseline} byId={byId} targetLang={targetLang} />
                ))}
              </ul>
            </div>
          )}
          {less.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Discussed less than in {languageName(baseline)}
              </h3>
              <ul className="space-y-2">
                {less.map((h) => (
                  <HighlightItem key={h.theme.id} h={h} baseline={baseline} byId={byId} targetLang={targetLang} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ThemeMatrix({
  data,
  byId,
  targetLang,
}: {
  data: GapsResponse;
  byId: Map<string, GapPaper>;
  targetLang: string;
}) {
  const [selected, setSelected] = useState<{ theme: GapTheme; lang: string } | null>(null);
  const selectedPapers = useMemo(
    () => (selected ? (selected.theme.papers[selected.lang] ?? []).map((id) => byId.get(id)).filter((p): p is GapPaper => Boolean(p)) : []),
    [selected, byId],
  );
  return (
    <section aria-labelledby="matrix-title" className="rounded-lg border bg-surface p-4">
      <h2 id="matrix-title" className="font-serif text-lg font-semibold">
        Every theme, every language
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">Share of each language’s sampled papers that discuss the theme. Select a cell to see those papers.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="min-w-[11rem] text-left font-medium text-muted-foreground">Theme</th>
              {data.languages.map((l) => (
                <th key={l.code} className="min-w-[4.25rem] text-center font-medium" title={`${languageName(l.code)}: ${l.total} relevant papers compared`}>
                  <span className="block">{languageName(l.code)}</span>
                  <span className="tabular font-normal text-muted-foreground">n={l.total}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.themes.map((theme) => (
              <tr key={theme.id}>
                <th scope="row" className="pr-2 text-left align-middle font-normal" title={theme.description}>
                  {theme.label}
                </th>
                {data.languages.map((l) => {
                  const s = themeShare(theme, l);
                  const active = selected?.theme.id === theme.id && selected.lang === l.code;
                  return (
                    <td key={l.code} className="p-0">
                      <button
                        type="button"
                        disabled={s.count === 0}
                        onClick={() => setSelected(active ? null : { theme, lang: l.code })}
                        aria-pressed={active}
                        aria-label={`${theme.label}, ${languageName(l.code)}: ${s.count} of ${s.total} papers`}
                        className={cn(
                          "tabular h-8 w-full rounded border text-center transition-colors",
                          s.count ? "cursor-pointer hover:border-foreground/40" : "border-dashed text-muted-foreground/50",
                          active && "ring-2 ring-ring",
                          s.share > 0.55 && "text-[var(--background)]",
                        )}
                        style={{ background: cellFill(s.share) }}
                      >
                        {s.count ? pct(s.share) : "–"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-2 text-sm">
            <span className="font-medium">{selected.theme.label}</span>
            <span className="text-muted-foreground"> in {languageName(selected.lang)} papers</span>
          </p>
          <EvidenceList papers={selectedPapers} targetLang={targetLang} />
        </div>
      )}
    </section>
  );
}

export function LanguageGaps() {
  const { hydrated, lastSearch } = useAppState();
  const response = lastSearch?.response ?? null;
  const key = response ? `${response.queryLanguage}|${response.query}|${response.tookMs}` : null;
  const [state, setState] = useState<{ key: string; data: GapsResponse | null; error: ClientApiError | null } | null>(null);
  const [baselineChoice, setBaselineChoice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(() => {
    if (!response || !key) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ key, data: null, error: null });
    api
      .gaps(gapsRequestFor(response), controller.signal)
      .then((data) => {
        analysisCache.set(key, data);
        setState({ key, data, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ key, data: null, error: err instanceof ClientApiError ? err : new ClientApiError("The analysis failed unexpectedly.", "internal", 0) });
      });
  }, [response, key]);

  useEffect(() => {
    if (!key || state?.key === key) return;
    const hit = analysisCache.get(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show a cached analysis for this search without refetching
    if (hit) setState({ key, data: hit, error: null });
    else run();
  }, [key, state?.key, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const data = state?.key === key ? state.data : null;
  const error = state?.key === key ? state.error : null;
  const byId = useMemo(() => new Map((data?.papers ?? []).map((p) => [p.id, p])), [data]);
  const baseline =
    data && baselineChoice && data.languages.some((l) => l.code === baselineChoice) ? baselineChoice : data ? defaultBaseline(data.languages) : null;
  const highlights = useMemo(() => (data && baseline ? computeHighlights(data, baseline) : []), [data, baseline]);

  if (!hydrated) return <div className="mx-auto h-[60vh] max-w-6xl animate-pulse px-4 sm:px-6" aria-busy="true" />;

  if (!response) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
        <Scale className="mx-auto mb-4 size-10 text-muted-foreground/60" aria-hidden="true" />
        <h1 className="font-serif text-2xl font-semibold">No search to compare yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Gaps compares what research in each language says about your latest search: the themes one language discusses that
          others rarely do. Run a search, then come back here.
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Go to Search</Link>
        </Button>
      </div>
    );
  }

  const targetLang = response.queryLanguage;
  const sampled = data?.languages.reduce((n, l) => n + l.total, 0) ?? 0;
  const others = data?.languages.filter((l) => l.code !== baseline) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Language gaps: what each language’s research emphasizes</p>
          <h1 className="font-serif text-xl leading-snug font-semibold sm:text-2xl" lang={response.queryLanguage}>
            {response.query}
          </h1>
          {data && data.languages.length > 0 && (
            <p className="tabular mt-1 text-sm text-muted-foreground">
              {sampled} relevant papers compared across {data.languages.length} languages · up to {GAP_SAMPLE_PER_LANGUAGE} sampled per language
              {data.model && <> · themes by {data.model}</>}
            </p>
          )}
        </div>
        <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
          <Link href={`/?q=${encodeURIComponent(response.query)}`}>
            <ArrowLeft aria-hidden="true" /> Back to results
          </Link>
        </Button>
      </div>

      <div className="mt-5 space-y-5">
        {!data && !error && (
          <div className="rounded-lg border bg-surface p-5" role="status">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin text-accent-brand" aria-hidden="true" />
              Comparing research across languages…
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Gathering each language’s most relevant papers, then reading their titles and abstracts to find the themes they
              discuss. This usually takes 20–60 seconds.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-md bg-secondary" />
              ))}
            </div>
          </div>
        )}

        {error && <ErrorState message={error.message} code={error.code} onRetry={run} />}

        {data && (
          <>
            {data.notices.map((n) => (
              <Notice key={n} tone="warning">
                {n}
              </Notice>
            ))}

            {data.overview && (
              <section aria-labelledby="overview-title" className="rounded-lg border border-accent-brand/25 bg-accent-brand-soft/40 p-4">
                <h2 id="overview-title" className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-accent-brand uppercase">
                  <Sparkles className="size-3.5" aria-hidden="true" /> AI summary
                </h2>
                <p className="mt-2 font-serif text-[17px] leading-relaxed">{data.overview}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Written by Gemini from the differences Prism counted below against{" "}
                  {languageName(defaultBaseline(data.languages))}. Each difference links to its papers.
                </p>
              </section>
            )}

            {data.themes.length > 0 && baseline && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-serif text-lg font-semibold">What each language adds</h2>
                  <div className="ml-auto flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Compared with</span>
                    <Select value={baseline} onValueChange={setBaselineChoice}>
                      <SelectTrigger size="sm" className="h-8 bg-surface" aria-label="Language to compare against">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {data.languages.map((l) => (
                          <SelectItem key={l.code} value={l.code}>
                            {languageName(l.code)} <span className="text-muted-foreground">({l.total})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {others.map((l) => (
                    <LanguageCard
                      key={l.code}
                      code={l.code}
                      total={l.total}
                      baseline={baseline}
                      highlights={highlights.filter((h) => h.language === l.code)}
                      byId={byId}
                      targetLang={targetLang}
                    />
                  ))}
                </div>
                <ThemeMatrix data={data} byId={byId} targetLang={targetLang} />
              </>
            )}

            <section className="space-y-1 px-1 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                How this works: the search’s query in each language is re-run on OpenAlex, and each language’s{" "}
                {GAP_SAMPLE_PER_LANGUAGE} most relevant papers (by semantic similarity to your question) are sampled. Gemini sets
                aside papers that aren’t about your question, names the themes the rest discuss, and tags each paper whose own title
                or abstract covers a theme. Prism counts the tags.
                A difference is pointed out when at least {GAP_MIN_COUNT} papers cover the theme and the shares differ by at least{" "}
                {Math.round(GAP_MIN_DIFF * 100)} percentage points.
              </p>
              <p>
                These are small samples of what OpenAlex indexes, judged from titles and abstracts only. A theme missing from a
                sample is not proof it’s missing from that language’s literature; treat differences as leads to explore.
              </p>
              {data.offTopic.length > 0 && (
                <p>
                  Set aside as not about your question (judged by Gemini from each paper’s text, and left out of every count):{" "}
                  {data.offTopic.map((l) => `${languageName(l.code)} (${l.count})`).join(", ")}.
                </p>
              )}
              {data.excluded.length > 0 && (
                <p>
                  Too few relevant papers to compare (fewer than {GAP_MIN_PAPERS}):{" "}
                  {data.excluded.map((l) => `${languageName(l.code)} (${l.total})`).join(", ")}.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
