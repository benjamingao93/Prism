"use client";

import { X } from "lucide-react";
import { languageLabel, languageName } from "@/lib/languages";
import type { RankingMode, SearchResponse } from "@/lib/types";
import { MODE_LABELS, RankingModeToggle } from "./RankingInfo";

interface Props {
  response: SearchResponse;
  mode: RankingMode;
  onModeChange: (m: RankingMode) => void;
  shownCount: number;
  topCount: number;
  refine: string[];
  minScore: number;
  onClearRefine: () => void;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-md border bg-surface px-2 py-0.5 text-xs text-secondary-foreground">{children}</span>;
}

export function ResultsHeader({ response, mode, onModeChange, shownCount, topCount, refine, minScore, onClearRefine }: Props) {
  const f = response.filters;
  const sources = [...new Set(response.variants.filter((v) => !v.error && !v.skipped).map((v) => v.source))];
  const translatedCount = response.variants.filter((v) => v.kind === "translated" && !v.skipped && !v.error).length;
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
            Top <span className="font-medium text-foreground">{topCount}</span> of {response.candidateCount} candidates from{" "}
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
        <Chip>Top {f.limit} overall</Chip>
        <Chip>Up to {f.limit} candidates per language</Chip>
        {minScore > 0 && <Chip>Min score {minScore.toFixed(2)}</Chip>}
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
      <p className="text-xs leading-relaxed text-muted-foreground">
        Every language could supply up to {f.limit} candidates, and the top {f.limit} are chosen by relevance alone, so the language
        mix reflects the literature rather than a quota. Scores compare papers
        within this candidate pool and are not judgments of scientific quality. This is a sample of OpenAlex records, not an
        exhaustive search.
      </p>
    </div>
  );
}
