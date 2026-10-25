"use client";

import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClientApiError, api } from "@/lib/client-api";
import { compareBaseline, computeCoverage } from "@/lib/comparison";
import { filterByMinScore, filterPapers } from "@/lib/filters";
import { languageName } from "@/lib/languages";
import { sortByMode } from "@/lib/ranking";
import {
  MAX_PAGES,
  QUERY_LANGUAGES,
  resultCount,
  type Capabilities,
  type RankedPaper,
  type RankingMode,
  type SearchResponse,
} from "@/lib/types";
import { useAppState } from "./AppState";
import { ComparisonPanel } from "./ComparisonPanel";
import { PaperCard, type PaperTranslation } from "./PaperCard";
import { ResultsHeader } from "./ResultsHeader";
import { FlagCollage } from "./Flags";
import { SearchBar } from "./SearchBar";
import { SpaceHero } from "./space/SpaceHero";
import { SearchCoverage } from "./SearchCoverage";
import { DEFAULT_SETTINGS, SearchSettings, type SearchSettingsValue } from "./SearchSettings";
import { ErrorState, InitialState, NoResults, ResultSkeleton, SourceNote } from "./SearchStates";
import { CapabilityNotices, Notice } from "./StatusNotice";

const PAGE_SIZE = 20;
const TRANSLATE_BATCH = 15;

type Status = "idle" | "loading" | "success" | "error";

export function SearchExperience() {
  const { queryLanguage, hydrated, lastSearch, setLastSearch } = useAppState();
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<SearchSettingsValue>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<Status>("idle");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<ClientApiError | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [refine, setRefine] = useState<string[]>([]);
  /** Publication-venue country filter (ISO alpha-2), set from the map tab. */
  const [country, setCountry] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  /** True while the landing's globe zooms into the results (LAUNCH_MS). */
  const [launching, setLaunching] = useState(false);
  const endLaunch = useCallback(() => setLaunching(false), []);
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
            limit: s.limit,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setResponse(res);
        setLastSearch({ response: res, mode: s.mode });
        setCaps(res.capabilities);
        setRefine([]);
        setCountry(null);
        setLoadMoreError(null);
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
    [queryLanguage, settings, setLastSearch],
  );

  // "Load more": the same search one page deeper in every language. Earlier pages, translations
  // and scores come from the server cache, so only new candidates cost time. The whole set is
  // re-ranked, so results already on screen can move.
  const loadMore = useCallback(async () => {
    if (!response || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await api.search({
        query: response.query,
        queryLanguage: response.queryLanguage,
        publicationLanguages: response.filters.publicationLanguages,
        yearFrom: response.filters.yearFrom,
        yearTo: response.filters.yearTo,
        mode: settings.mode,
        limit: response.filters.limit,
        pages: response.filters.pages + 1,
      });
      setResponse(res);
      setLastSearch({ response: res, mode: settings.mode });
      setVisible((v) => v + PAGE_SIZE);
    } catch (err) {
      setLoadMoreError(err instanceof ClientApiError ? err.message : "Could not load more results.");
    } finally {
      setLoadingMore(false);
    }
  }, [response, loadingMore, settings.mode, setLastSearch]);

  // React to the URL: shareable ?q= links, and returning from the map with ?country=. Next keeps
  // this page alive (hidden) while another tab is shown, so this must follow URL changes rather
  // than run once on mount. A query that matches the last search (shared with the map tab) is
  // restored instead of searched again.
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q")?.trim() ?? "";
  const urlCountry = searchParams.get("country");
  const loadQueryFromUrl = useCallback(
    (q: string) => {
      lastQueryRef.current = q;
      setQuery(q);
      if (lastSearch && lastSearch.response.query === q) {
        generationRef.current += 1;
        requestedRef.current = new Set();
        setResponse(lastSearch.response);
        setCaps(lastSearch.response.capabilities);
        setSettings((s) => ({ ...s, mode: lastSearch.mode }));
        setStatus("success");
      } else {
        void runSearch(q);
      }
    },
    [lastSearch, runSearch],
  );
  useEffect(() => {
    if (hydrated && urlQuery && urlQuery !== lastQueryRef.current) loadQueryFromUrl(urlQuery);
  }, [hydrated, urlQuery, loadQueryFromUrl]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the country filter from the URL
    setCountry(urlCountry && /^[A-Z]{2}$/.test(urlCountry) ? urlCountry : null);
  }, [urlCountry]);

  // Keep the map tab in sync with the ranking mode, and the URL in sync with the country filter.
  useEffect(() => {
    if (response && lastSearch?.response === response && lastSearch.mode !== settings.mode) {
      setLastSearch({ response, mode: settings.mode });
    }
  }, [response, settings.mode, lastSearch, setLastSearch]);
  useEffect(() => {
    if (!response) return;
    try {
      const url = new URL(window.location.href);
      if (country) url.searchParams.set("country", country);
      else url.searchParams.delete("country");
      window.history.replaceState(null, "", url);
    } catch {
      // ignore URL errors
    }
  }, [country, response]);

  const mode: RankingMode = response && !response.availableModes.includes(settings.mode) ? response.effectiveMode : settings.mode;

  // The top N for the active mode: the response carries each mode's top N, so this is exact.
  const topResults = useMemo(
    () => (response ? sortByMode(response.papers, mode).slice(0, resultCount(response.filters)) : []),
    [response, mode],
  );

  const displayed = useMemo(() => {
    const refined = filterPapers(topResults, { languages: refine, yearFrom: null, yearTo: null }).filter(
      (p) => !country || p.country === country,
    );
    return filterByMinScore(refined, mode, settings.minScore);
  }, [topResults, mode, refine, country, settings.minScore]);

  const shown = displayed.slice(0, visible);
  const variantMap = useMemo(() => new Map((response?.variants ?? []).map((v) => [v.id, v])), [response]);
  const coverage = useMemo(() => (response ? computeCoverage(topResults, response.variants) : null), [response, topResults]);
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
    // Papers already published in the reader's language don't need a title translation. (The
    // reverse case, e.g. a Chinese paper with English metadata, is detected server-side.)
    const pending = shown
      .filter((p) => p.title && p.language !== targetLang && !requestedRef.current.has(p.id))
      .slice(0, TRANSLATE_BATCH);
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
      settings.limit !== response.filters.limit ||
      queryLanguage !== response.queryLanguage);

  // While the globe zooms in, hold the (heavy) results render so the animation stays smooth.
  const hasResults = status === "success" && response && !launching;
  const showSkeleton = status === "loading" || (status === "success" && launching);
  // Before the first search the page is the space landing; searching launches into the results.
  const landing = status === "idle";

  const submit = () => {
    if (landing) {
      if (query.trim().length < 2) return;
      window.scrollTo({ top: 0 });
      setLaunching(true);
    }
    void runSearch(query);
  };

  const renderSearchControls = (compact: boolean) => (
    <>
      <SearchBar
        value={query}
        onChange={setQuery}
        onSubmit={submit}
        loading={status === "loading"}
        languageLabel={`Query in ${languageName(queryLanguage)}`}
        compact={compact}
      />
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
    </>
  );

  return (
    <>
      {(landing || launching) && (
        <SpaceHero launching={launching} onLaunchEnd={endLaunch} side={<FlagCollage className="h-full" />}>
          {renderSearchControls(false)}
        </SpaceHero>
      )}
      {landing ? (
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-12 sm:px-6">
          <CapabilityNotices caps={caps} />
          <InitialState />
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <section className="space-y-3 pt-6 pb-5">{renderSearchControls(true)}</section>

        <div className="pb-16">
          {showSkeleton && (
            <ResultSkeleton
              note={
                caps?.embeddings === "loading"
                  ? "Retrieving papers… the embedding model is still loading on first run."
                  : `Searching ${settings.publicationLanguages.length || QUERY_LANGUAGES.length} languages, then ranking candidates from each in proportion to its literature…`
              }
            />
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
                  topCount={topResults.length}
                  refine={refine}
                  country={country}
                  onClearCountry={() => setCountry(null)}
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

                {comparison && <ComparisonPanel comparison={comparison} candidateCount={response.candidateCount} />}

                {displayed.length === 0 ? (
                  <NoResults
                    filtered={response.papers.length > 0}
                    onReset={() => {
                      setRefine([]);
                      setCountry(null);
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
                    <div className="flex flex-col items-center gap-1.5 pt-2 text-center">
                      {displayed.length > visible ? (
                        <Button variant="outline" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                          <ChevronDown /> Show more ({displayed.length - visible} remaining)
                        </Button>
                      ) : response.canLoadMore ? (
                        <>
                          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                            {loadingMore ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                            {loadingMore ? "Searching deeper in every language…" : `Load ${response.filters.limit} more results`}
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Searches one page deeper in every language and re-ranks everything together.
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {response.filters.pages >= MAX_PAGES
                            ? `That's the deepest Prism searches (${resultCount(response.filters)} results).`
                            : "No more results: every language's matches have been retrieved."}
                        </p>
                      )}
                      {loadMoreError && (
                        <p role="alert" className="text-xs text-destructive">
                          {loadMoreError}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <SourceNote />
              </div>

              <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                {coverage && (
                  <SearchCoverage
                    coverage={coverage}
                    candidateCount={response.candidateCount}
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
      )}
    </>
  );
}
