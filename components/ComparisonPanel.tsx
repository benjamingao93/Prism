"use client";

import { GitCompareArrows } from "lucide-react";
import type { Comparison } from "@/lib/comparison";
import { languageName } from "@/lib/languages";
import { LanguageBadge, paperLanguageProps } from "./LanguageBadge";

export function ComparisonPanel({ comparison, candidateCount }: { comparison: Comparison; candidateCount: number }) {
  const { k, baselineVariant, overlap, additional } = comparison;
  if (!baselineVariant) return null;

  return (
    <section aria-labelledby="comparison-title" className="rounded-lg border bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <GitCompareArrows className="size-4 text-accent-brand" aria-hidden="true" />
        <h2 id="comparison-title" className="font-serif text-base font-semibold">
          Original-language vs. multilingual search
        </h2>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Baseline: only the {languageName(baselineVariant.lang)} query “{baselineVariant.searchQuery}”. Multilingual: that query plus
        its translated variants. Same filters, page size, and scoring.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border bg-background/60 px-2 py-2.5">
          <div className="tabular font-serif text-xl font-semibold">{baselineVariant.hitCount}</div>
          <div className="text-[11px] text-muted-foreground">baseline candidates</div>
        </div>
        <div className="rounded-md border bg-background/60 px-2 py-2.5">
          <div className="tabular font-serif text-xl font-semibold">{candidateCount}</div>
          <div className="text-[11px] text-muted-foreground">multilingual candidates</div>
        </div>
        <div className="rounded-md border bg-background/60 px-2 py-2.5">
          <div className="tabular font-serif text-xl font-semibold">{Math.round(overlap * 100)}%</div>
          <div className="text-[11px] text-muted-foreground">top-{k} overlap</div>
        </div>
      </div>

      <h3 className="mt-4 mb-1.5 text-sm font-medium">Additional papers found by multilingual search</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Papers in the multilingual top {k} that the baseline query did not retrieve. Additional does not mean relevant — review each one.
      </p>
      {additional.length === 0 ? (
        <p className="text-sm text-muted-foreground">None in the top {k} for the current ranking.</p>
      ) : (
        <ol className="space-y-1.5">
          {additional.map((p) => (
            <li key={p.id} className="flex items-start gap-2 text-sm">
              <LanguageBadge {...paperLanguageProps(p)} className="mt-0.5 shrink-0" />
              <a
                href={`#paper-${encodeURIComponent(p.id)}`}
                className="min-w-0 font-serif leading-snug hover:text-accent-brand hover:underline"
                lang={p.language ?? undefined}
              >
                {p.title ?? "Untitled record"}
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
