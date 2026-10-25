"use client";

import { AlertCircle, CheckCircle2, CircleSlash, RefreshCw } from "lucide-react";
import Link from "next/link";
import type { Coverage } from "@/lib/comparison";
import { languageLabel, languageName } from "@/lib/languages";
import type { QueryVariant } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  coverage: Coverage;
  candidateCount: number;
  variants: QueryVariant[];
  refine: string[];
  onToggleRefine: (code: string) => void;
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2.5" title={hint}>
      <div className="tabular font-serif text-2xl leading-none font-semibold">{value}</div>
      <div className="mt-1 text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

export function SearchCoverage({ coverage, candidateCount, variants, refine, onToggleRefine }: Props) {
  const max = Math.max(1, ...coverage.languages.map((l) => l.count));
  return (
    <section aria-labelledby="coverage-title" className="rounded-lg border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="coverage-title" className="font-serif text-base font-semibold">
          Search coverage
        </h2>
        <Link href="/map" className="text-xs text-accent-brand hover:underline">
          View on map
        </Link>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Computed from the top results shown, ranked from all candidates.</p>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Top results" value={coverage.uniquePapers} />
        <Stat label="Publication languages" value={coverage.languageCount} hint="Languages reported in source metadata" />
        <Stat
          label="Found only via translated queries"
          value={coverage.viaTranslatedOnly}
          hint="Papers that the original-language query did not retrieve"
        />
        <Stat label="Candidates ranked" value={candidateCount} hint="Unique papers retrieved across all languages before taking the top results" />
      </div>

      <h3 className="mt-4 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Top results by language</h3>
      <ul className="space-y-1">
        {coverage.languages.map((l) => {
          const code = l.code ?? "unknown";
          const active = refine.includes(code);
          return (
            <li key={code}>
              <button
                type="button"
                onClick={() => onToggleRefine(code)}
                aria-pressed={active}
                className={cn(
                  "group grid w-full grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted",
                  active && "bg-accent-brand-soft",
                )}
              >
                <span className={cn("truncate", !l.code && "text-muted-foreground italic")}>{languageLabel(l.code)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <span
                    className={cn("block h-full rounded-full", l.code && l.code !== "en" ? "bg-accent-brand" : "bg-foreground/35")}
                    style={{ width: `${(l.count / max) * 100}%` }}
                  />
                </span>
                <span className="tabular w-6 text-right text-muted-foreground">{l.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Click a language to filter the results shown.
        {coverage.correctedLanguages > 0 &&
          ` ${coverage.correctedLanguages} language tag${coverage.correctedLanguages === 1 ? " was" : "s were"} corrected from the paper's text (dashed badges).`}
      </p>

      <h3 className="mt-4 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Query variants</h3>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        Candidates are drawn from each language in proportion to the size of its literature on the topic (at least 2), then
        ranked together. “~N” is that estimated size.
      </p>
      <ul className="space-y-1.5">
        {variants.map((v) => (
          <li key={v.id} className="text-xs">
            <div className="flex items-center gap-1.5">
              {v.skipped ? (
                <CircleSlash className="size-3.5 shrink-0 text-muted-foreground" aria-label="Skipped" />
              ) : v.error ? (
                <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-label="Failed" />
              ) : (
                <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-label="Succeeded" />
              )}
              <span className="font-medium">
                {v.kind === "original" ? `Original · ${languageName(v.lang)}` : languageName(v.lang)}
                {v.source === "crossref" && " · Crossref"}
              </span>
              <span
                className="tabular ml-auto text-muted-foreground"
                title={`Candidates ranked · estimated papers on “${v.topic}” in this language`}
              >
                {v.skipped
                  ? "skipped"
                  : v.error
                    ? "failed"
                    : `${v.kept} ranked${v.matchCount != null ? ` of ~${v.matchCount.toLocaleString("en")}` : ""}`}
              </span>
            </div>
            <p className="mt-0.5 truncate pl-5 text-muted-foreground" lang={v.lang} title={v.text}>
              “{v.searchQuery}”
              {v.relaxed && (
                <span className="ml-1 inline-flex items-center gap-0.5 text-warning" title="The strict query returned too few results, so a broader query was used">
                  <RefreshCw className="size-3" aria-hidden="true" /> broadened
                </span>
              )}
            </p>
            {(v.error || v.skipped) && <p className="pl-5 text-[11px] text-muted-foreground">{v.error ?? v.skipped}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
