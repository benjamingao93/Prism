"use client";

import { ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClientApiError, api } from "@/lib/client-api";
import { compareBaseline, computeCoverage } from "@/lib/comparison";
import { filterByMinScore, filterPapers } from "@/lib/filters";
import { languageName } from "@/lib/languages";
import { sortByMode } from "@/lib/ranking";
import type { Capabilities, RankedPaper, RankingMode, SearchResponse } from "@/lib/types";
import { useAppState } from "./AppState";
import { ComparisonPanel } from "./ComparisonPanel";
import { PaperCard, type PaperTranslation } from "./PaperCard";
import { ResultsHeader } from "./ResultsHeader";
import { ExampleQueries, SearchBar } from "./SearchBar";
import { SearchCoverage } from "./SearchCoverage";
import { DEFAULT_SETTINGS, SearchSettings, type SearchSettingsValue } from "./SearchSettings";
import { ErrorState, InitialState, NoResults, ResultSkeleton, SourceNote } from "./SearchStates";
import { CapabilityNotices, Notice } from "./StatusNotice";

const PAGE_SIZE = 20;
const TRANSLATE_BATCH = 15;

type Status = "idle" | "loading" | "success" | "error";

export function SearchExperience() {
  const { queryLanguage } = useAppState();
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<SearchSettingsValue>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<Status>("idle");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [refine, setRefine] = useState<string[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [translations, setTranslations] = useState<Record<string, PaperTranslation>>({});
  const abortRef = useRef<AbortController | null>(null);
  const requestedRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const lastQueryRef = useRef<string>("");

  // Capabilities: poll while the embedding model is loading.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const c = await api.status();
        if (cancelled) return;
        setCaps(c);
        if (c.embeddings === "loading" || c.embeddings === "idle") timer = setTimeout(poll, 4000);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 10_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const runSearch = useCallback(
    async (q: string, s: SearchSettingsValue = settings) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastQueryRef.current = trimmed;
      setStatus("loading");
      setError(null);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("q", trimmed);
        window.history.replaceState(null, "", url);
      } catch {
        // ignore URL errors
      }
      try {
        const res = await api.search(
          {
            query: trimmed,
            queryLanguage,
            publicationLanguages: s.publicationLanguages,
            yearFrom: s.yearFrom,
            yearTo: s.yearTo,
            mode: s.mode,
            perVariant: s.perVariant,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setResponse(res);
        setCaps(res.capabilities);
        setRefine([]);
        setVisible(PAGE_SIZE);
        generationRef.current += 1;
        requestedRef.current = new Set();
        setTranslations({});
        setStatus("success");
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof ClientApiError ? err : new ClientApiError("Search failed unexpectedly.", "internal", 0));
        setStatus("error");
      }
    },
    [queryLanguage, settings],
  );

  // Support shareable ?q= links.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize from URL once on mount
      setQuery(q);
      void runSearch(q);
    }
  }, [runSearch]);

  const mode: RankingMode = response && !response.availableModes.includes(settings.mode) ? response.effectiveMode : settings.mode;

  const displayed = useMemo(() => {
    if (!response) return [];
    const sorted = sortByMode(response.papers, mode);
    const refined = filterPapers(sorted, { languages: refine, yearFrom: null, yearTo: null });
    return filterByMinScore(refined, mode, settings.minScore);
  }, [response, mode, refine, settings.minScore]);

  const shown = displayed.slice(0, visible);
  const variantMap = useMemo(() => new Map((response?.variants ?? []).map((v) => [v.id, v])), [response]);
  const coverage = useMemo(() => (response ? computeCoverage(response.papers, response.variants) : null), [response]);
  const comparison = useMemo(
    () => (response && settings.compare ? compareBaseline(response.papers, response.variants, mode, 10) : null),
    [response, settings.compare, mode],
  );

  const llmAvailable = Boolean(response?.capabilities.llm ?? caps?.llm);
  const translationEnabled = settings.translate && llmAvailable;
  const targetLang = response?.queryLanguage ?? queryLanguage;

  // Lazily translate titles of the papers currently on screen, in small batches.
  // Requested ids live in a ref so re-renders never re-send or cancel a batch; the generation
  // counter discards responses that arrive after a new search started.
  useEffect(() => {
    if (!translationEnabled || !response) return;
    const pending = shown.filter((p) => p.title && !requestedRef.current.has(p.id)).slice(0, TRANSLATE_BATCH);
    if (!pending.length) return;
    for (const p of pending) requestedRef.current.add(p.id);
    const gen = generationRef.current;
    const update = (fn: (t: Record<string, PaperTranslation>) => Record<string, PaperTranslation>) => {
      if (gen === generationRef.current) setTranslations(fn);
    };
    update((t) => {
      const next = { ...t };
      for (const p of pending) next[p.id] = { ...next[p.id], titleStatus: "pending" };
      return next;
    });
    api
      .translate({ targetLang, items: pending.map((p) => ({ id: p.id, title: p.title, abstract: null })) })
      .then((res) =>
        update((t) => {
          const next = { ...t };
          for (const item of res.items) {
            next[item.id] = {
              ...next[item.id],
              title: item.title,
              titleAlreadyInTarget: item.titleAlreadyInTarget,
              titleStatus: "done",
              model: res.model,
            };
          }
          return next;
        }),
      )
      .catch(() =>
        update((t) => {
          const next = { ...t };
          for (const p of pending) next[p.id] = { ...next[p.id], titleStatus: "error" };
          return next;
        }),
      );
  }, [shown, translationEnabled, response, targetLang]);

  const translateAbstract = useCallback(
    async (paper: RankedPaper) => {
      if (!paper.abstract) return;
      setTranslations((t) => ({ ...t, [paper.id]: { ...t[paper.id], abstractStatus: "pending" } }));
      try {
        const res = await api.translate({ targetLang, items: [{ id: paper.id, title: null, abstract: paper.abstract }] });
        const item = res.items[0];
        setTranslations((t) => ({
          ...t,
          [paper.id]: {
            ...t[paper.id],
            abstract: item?.abstract ?? null,
            abstractAlreadyInTarget: item?.abstractAlreadyInTarget ?? false,
            abstractStatus: "done",
            model: res.model,
          },
        }));
      } catch {
        setTranslations((t) => ({ ...t, [paper.id]: { ...t[paper.id], abstractStatus: "error" } }));
      }
    },
    [targetLang],
  );

  const filtersChanged =
    response != null &&
    (JSON.stringify([...settings.publicationLanguages].sort()) !== JSON.stringify([...response.filters.publicationLanguages].sort()) ||
      settings.yearFrom !== response.filters.yearFrom ||
      settings.yearTo !== response.filters.yearTo ||
      settings.perVariant !== response.filters.perVariant ||
      queryLanguage !== response.queryLanguage);

  const hasResults = status === "success" && response;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className={hasResults || status === "loading" ? "pt-6 pb-5" : "pt-14 pb-8 sm:pt-20"}>
        {!(hasResults || status === "loading") && (
          <div className="mb-7 max-w-2xl">
            <h1 className="font-serif text-[2rem] leading-[1.1] font-semibold tracking-tight sm:text-5xl">
              Research has no single language.
            </h1>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Discover relevant scientific papers across languages with multilingual search and semantic relevance ranking.
            </p>
          </div>
        )}
        <div className="space-y-3">
          <SearchBar
            value={query}
            onChange={setQuery}
            onSubmit={() => runSearch(query)}
            loading={status === "loading"}
            languageLabel={`Query in ${languageName(queryLanguage)}`}
            compact={Boolean(hasResults)}
          />
          <div className={hasResults ? "hidden sm:block" : undefined}>
            <ExampleQueries
            disabled={status === "loading"}
            onPick={(q) => {
              setQuery(q);
              void runSearch(q);
            }}
            />
          </div>
          <SearchSettings
            value={settings}
            onChange={setSettings}
            availableModes={
              response?.availableModes ??
              (caps?.embeddings === "failed" || caps?.embeddings === "disabled" ? ["keyword"] : ["hybrid", "semantic", "keyword"])
            }
            llmAvailable={llmAvailable}
          />
          {filtersChanged && (
            <Notice tone="info">
              <span className="flex flex-wrap items-center gap-2">
                Retrieval settings changed since this search.
                <Button size="xs" variant="outline" onClick={() => runSearch(lastQueryRef.current || query)}>
                  <RefreshCw /> Update results
                </Button>
              </span>
            </Notice>
          )}
        </div>
      </section>

      <div className="pb-16">
        {status === "idle" && (
          <div className="space-y-4">
            <CapabilityNotices caps={caps} />
            <InitialState />
          </div>
        )}

        {status === "loading" && (
          <ResultSkeleton note={caps?.embeddings === "loading" ? "Retrieving papers… the embedding model is still loading on first run." : null} />
        )}

        {status === "error" && error && <ErrorState message={error.message} code={error.code} onRetry={() => runSearch(lastQueryRef.current || query)} />}

        {hasResults && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="min-w-0 space-y-4">
              <ResultsHeader
                response={response}
                mode={mode}
                onModeChange={(m) => setSettings((s) => ({ ...s, mode: m }))}
                shownCount={displayed.length}
                refine={refine}
                minScore={settings.minScore}
                onClearRefine={() => setRefine([])}
              />
              {response.notices.length > 0 && (
                <div className="space-y-1.5">
                  {response.notices.map((n) => (
                    <Notice key={n} tone={/unavailable|failed|left out/i.test(n) ? "warning" : "info"}>
                      {n}
                    </Notice>
                  ))}
                </div>
              )}

              {comparison && <ComparisonPanel comparison={comparison} />}

              {displayed.length === 0 ? (
                <NoResults
                  filtered={response.papers.length > 0}
                  onReset={() => {
                    setRefine([]);
                    setSettings((s) => ({ ...s, minScore: 0 }));
                  }}
                />
              ) : (
                <div className="space-y-3" data-testid="results-list">
                  {shown.map((p, i) => (
                    <PaperCard
                      key={p.id}
                      paper={p}
                      mode={mode}
                      position={i + 1}
                      variants={variantMap}
                      targetLang={targetLang}
                      translation={translations[p.id]}
                      translationEnabled={translationEnabled}
                      llmAvailable={llmAvailable}
                      onTranslateAbstract={translateAbstract}
                    />
                  ))}
                  {displayed.length > visible && (
                    <div className="flex justify-center pt-2">
                      <Button variant="outline" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                        <ChevronDown /> Show more ({displayed.length - visible} remaining)
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <SourceNote />
            </div>

            <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
              {coverage && (
                <SearchCoverage
                  coverage={coverage}
                  variants={response.variants}
                  refine={refine}
                  onToggleRefine={(code) =>
                    setRefine((r) => (r.includes(code) ? r.filter((c) => c !== code) : [...r, code]))
                  }
                />
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
