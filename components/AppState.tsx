"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Paper, QueryLanguage, RankingMode, SearchResponse } from "@/lib/types";
import { QUERY_LANGUAGES } from "@/lib/types";

/** Minimal snapshot of a saved paper — real metadata only, stored in this browser. */
export type SavedPaper = Pick<Paper, "id" | "title" | "authors" | "year" | "venue" | "doi" | "language" | "landingUrl"> & {
  savedAt: number;
};

/** The most recent search, shared with the map tab. */
export interface LastSearch {
  response: SearchResponse;
  mode: RankingMode;
}

interface AppState {
  /** True once browser storage has been read; consumers that restore state should wait for it. */
  hydrated: boolean;
  lastSearch: LastSearch | null;
  setLastSearch: (s: LastSearch | null) => void;
  queryLanguage: QueryLanguage;
  setQueryLanguage: (lang: QueryLanguage) => void;
  saved: SavedPaper[];
  isSaved: (id: string) => boolean;
  toggleSaved: (paper: Paper) => void;
  removeSaved: (id: string) => void;
  clearSaved: () => void;
}

const Ctx = createContext<AppState | null>(null);

const LANG_KEY = "prism:query-language";
const SAVED_KEY = "prism:reading-list";
/** Session-scoped so a reload of the map tab still shows the last search. */
const LAST_SEARCH_KEY = "prism:last-search";
/** Keys used before the rename to Prism; read once so saved papers carry over. */
const LEGACY_KEYS: Record<string, string> = {
  [LANG_KEY]: "babel-scholar:query-language",
  [SAVED_KEY]: "babel-scholar:reading-list",
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(LEGACY_KEYS[key] ?? "");
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota) — keep in-memory state only.
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [queryLanguage, setLang] = useState<QueryLanguage>("en");
  const [saved, setSaved] = useState<SavedPaper[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [lastSearch, setLastSearchState] = useState<LastSearch | null>(null);

  useEffect(() => {
    const lang = readStorage<string>(LANG_KEY, "en");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from browser storage after mount
    if ((QUERY_LANGUAGES as readonly string[]).includes(lang)) setLang(lang as QueryLanguage);
    const list = readStorage<SavedPaper[]>(SAVED_KEY, []);
    if (Array.isArray(list)) setSaved(list.filter((p) => p && typeof p.id === "string"));
    try {
      const raw = window.sessionStorage.getItem(LAST_SEARCH_KEY);
      const parsed = raw ? (JSON.parse(raw) as LastSearch) : null;
      if (parsed?.response && Array.isArray(parsed.response.papers)) setLastSearchState(parsed);
    } catch {
      // Unavailable or corrupt — start without a previous search.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeStorage(SAVED_KEY, saved);
  }, [saved, hydrated]);

  const setLastSearch = useCallback((s: LastSearch | null) => {
    setLastSearchState(s);
    try {
      if (s) window.sessionStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(s));
      else window.sessionStorage.removeItem(LAST_SEARCH_KEY);
    } catch {
      // Quota or privacy mode: keep it in memory only.
    }
  }, []);

  const setQueryLanguage = useCallback((lang: QueryLanguage) => {
    setLang(lang);
    writeStorage(LANG_KEY, lang);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      hydrated,
      lastSearch,
      setLastSearch,
      queryLanguage,
      setQueryLanguage,
      saved,
      isSaved: (id) => saved.some((p) => p.id === id),
      toggleSaved: (paper) =>
        setSaved((list) =>
          list.some((p) => p.id === paper.id)
            ? list.filter((p) => p.id !== paper.id)
            : [
                {
                  id: paper.id,
                  title: paper.title,
                  authors: paper.authors.slice(0, 6),
                  year: paper.year,
                  venue: paper.venue,
                  doi: paper.doi,
                  language: paper.language,
                  landingUrl: paper.landingUrl,
                  savedAt: Date.now(),
                },
                ...list,
              ],
        ),
      removeSaved: (id) => setSaved((list) => list.filter((p) => p.id !== id)),
      clearSaved: () => setSaved([]),
    }),
    [hydrated, lastSearch, setLastSearch, queryLanguage, setQueryLanguage, saved],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
