"use client";

import { Info } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RankingMode } from "@/lib/types";

export const MODE_LABELS: Record<RankingMode, string> = {
  hybrid: "Hybrid",
  semantic: "Semantic",
  keyword: "Keyword",
};

export const MODE_DESCRIPTIONS: Record<RankingMode, string> = {
  hybrid:
    "70% semantic similarity + 30% keyword (BM25) score, each min-max normalized within this result set. The weights are tunable starting values, not validated constants.",
  semantic:
    "Cosine similarity between multilingual embeddings of your original question and each paper's title and abstract (paraphrase-multilingual-MiniLM-L12-v2). Comparable across languages, though not perfectly language-neutral.",
  keyword:
    "BM25 over titles and abstracts using your question and its translated keyword variants. Each paper keeps its best-matching variant, so papers are not penalized for lacking English terms. Normalized within this result set.",
};

export function RankingModeToggle({
  value,
  onChange,
  available,
}: {
  value: RankingMode;
  onChange: (m: RankingMode) => void;
  available: RankingMode[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={value}
        onValueChange={(v) => v && onChange(v as RankingMode)}
        aria-label="Ranking mode"
        className="bg-surface"
      >
        {(["hybrid", "semantic", "keyword"] as const).map((m) => (
          <ToggleGroupItem
            key={m}
            value={m}
            disabled={!available.includes(m)}
            className="px-2.5 text-xs data-[state=on]:bg-accent-blue-soft data-[state=on]:text-accent-blue"
            title={available.includes(m) ? undefined : "Requires the multilingual embedding model"}
          >
            {MODE_LABELS[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="How this ranking works" className="rounded p-1 text-muted-foreground hover:text-foreground">
            <Info className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
          {MODE_DESCRIPTIONS[value]}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
