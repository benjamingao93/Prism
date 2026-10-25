"use client";

import { X } from "lucide-react";
import { countryName } from "@/lib/countries";
import { languageLabel, languageName } from "@/lib/languages";
import { resultCount, type RankingMode, type SearchResponse } from "@/lib/types";
import { MODE_LABELS, RankingModeToggle } from "./RankingInfo";

interface Props {
  response: SearchResponse;
  mode: RankingMode;
  onModeChange: (m: RankingMode) => void;
  shownCount: number;
  topCount: number;
  refine: string[];
  country: string | null;
  onClearCountry: () => void;
  minScore: number;
  onClearRefine: () => void;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-md border bg-surface px-2 py-0.5 text-xs text-secondary-foreground">{children}</span>;
}

export function ResultsHeader({
  response,
  mode,
  onModeChange,
  shownCount,
  topCount,
  refine,
  country,
  onClearCountry,
  minScore,
  onClearRefine,
}: Props) {
  const f = response.filters;
  const sources = [...new Set(response.variants.filter((v) => !v.error && !v.skipped).map((v) => v.source))];
  const translatedCount = response.variants.filter((v) => v.kind === "translated" && !v.skipped && !v.error).length;
  // Papers matching the queries that ran, summed over languages (an upper bound; overlaps exist).
  const matching = response.variants
    .filter((v) => v.source === "openalex" && !v.skipped && !v.error)
    .reduce((n, v) => n + (v.totalAvailable ?? 0), 0);
  const degraded = mode !== response.effectiveMode || !response.availableModes.includes(mode);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Results for</p>
          <h2 className="font-serif text-xl leading-snug font-semibold sm:text-2xl" lang={response.queryLanguage}>
            {response.query}
          </h2>
          <p className="tabular mt-1 text-sm text-muted-foreground" aria-live="polite">
            Top <span className="font-medium text-foreground">{topCount}</span> of {response.candidateCount} candidates (from{" "}
            {response.retrievedCount} retrieved) from{" "}
            {sources.map((s) => (s === "openalex" ? "OpenAlex" : "Crossref")).join(" and ") || "no sources"}, searched with your query
            {translatedCount > 0 && <> and {translatedCount} translations</>}
            {shownCount !== topCount && <> · {shownCount} shown</>} ·{" "}
            <span className="text-muted-foreground/80">{(response.tookMs / 1000).toFixed(1)}s</span>
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <RankingModeToggle
            value={response.availableModes.includes(mode) ? mode : response.effectiveMode}
            onChange={onModeChange}
            available={response.availableModes}
          />
          <span className="text-[11px] text-muted-foreground">
            Ranked by {MODE_LABELS[response.availableModes.includes(mode) ? mode : response.effectiveMode].toLowerCase()} relevance
            {degraded && " (semantic unavailable)"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip>Query: {languageName(response.queryLanguage)}</Chip>
        <Chip>
          {f.publicationLanguages.length ? `Published in: ${f.publicationLanguages.map((l) => languageName(l)).join(", ")}` : "All publication languages"}
        </Chip>
        <Chip>{f.yearFrom || f.yearTo ? `Years ${f.yearFrom ?? "…"}–${f.yearTo ?? "…"}` : "Any year"}</Chip>
        <Chip>Top {resultCount(f)} overall</Chip>
        {matching > 0 && <Chip>~{matching.toLocaleString("en")} matching in OpenAlex</Chip>}

        {minScore > 0 && <Chip>Min score {minScore.toFixed(2)}</Chip>}
        {country && (
          <button
            type="button"
            onClick={onClearCountry}
            className="inline-flex items-center gap-1 rounded-md border border-accent-blue/30 bg-accent-blue-soft px-2 py-0.5 text-xs text-accent-blue"
          >
            Published in: {countryName(country)} <X className="size-3" aria-label="Clear" />
          </button>
        )}
        {refine.length > 0 && (
          <button
            type="button"
            onClick={onClearRefine}
            className="inline-flex items-center gap-1 rounded-md border border-accent-blue/30 bg-accent-blue-soft px-2 py-0.5 text-xs text-accent-blue"
          >
            Showing: {refine.map(languageLabel).join(", ")} <X className="size-3" aria-label="Clear" />
          </button>
        )}
      </div>
    </div>
  );
}
