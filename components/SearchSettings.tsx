"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { languageLabel } from "@/lib/languages";
import { PUBLICATION_LANGUAGES, RESULT_LIMITS, type RankingMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MODE_DESCRIPTIONS, RankingModeToggle } from "./RankingInfo";

export interface SearchSettingsValue {
  publicationLanguages: string[];
  yearFrom: number | null;
  yearTo: number | null;
  mode: RankingMode;
  /** Top-N results across all languages; also the most candidates any one language may supply. */
  limit: number;
  minScore: number;
  translate: boolean;
  compare: boolean;
}

export const DEFAULT_SETTINGS: SearchSettingsValue = {
  publicationLanguages: [],
  yearFrom: null,
  yearTo: null,
  mode: "hybrid",
  limit: 100,
  minScore: 0,
  translate: true,
  compare: false,
};

const CURRENT_YEAR = new Date().getFullYear();

function Segmented({ options, value, onChange }: { options: [number, string][]; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {options.map(([n, label]) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          onClick={() => onChange(n)}
          className={cn(
            "h-7 rounded-md border px-2.5 text-xs",
            value === n ? "border-accent-blue/40 bg-accent-blue-soft text-accent-blue" : "bg-surface text-muted-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function YearInput({ id, value, onChange, placeholder }: { id: string; value: number | null; onChange: (v: number | null) => void; placeholder: string }) {
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={1800}
      max={CURRENT_YEAR + 1}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const n = e.target.value ? Number(e.target.value) : null;
        onChange(n != null && Number.isFinite(n) ? Math.trunc(n) : null);
      }}
      className="tabular h-8 w-24 rounded-md border border-input bg-surface px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
    />
  );
}

interface Props {
  value: SearchSettingsValue;
  onChange: (v: SearchSettingsValue) => void;
  availableModes: RankingMode[];
  llmAvailable: boolean;
}

export function SearchSettings({ value, onChange, availableModes, llmAvailable }: Props) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof SearchSettingsValue>(k: K, v: SearchSettingsValue[K]) => onChange({ ...value, [k]: v });
  const allLanguages = value.publicationLanguages.length === 0;
  const activeCount =
    (allLanguages ? 0 : 1) + (value.yearFrom || value.yearTo ? 1 : 0) + (value.minScore > 0 ? 1 : 0) +
    (value.limit !== DEFAULT_SETTINGS.limit ? 1 : 0);

  const toggleLang = (code: string, checked: boolean) => {
    const next = checked ? [...value.publicationLanguages, code] : value.publicationLanguages.filter((c) => c !== code);
    set("publicationLanguages", next.length === PUBLICATION_LANGUAGES.length ? [] : next);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-surface">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 rounded-xl">
        <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">Search settings</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {allLanguages ? "All publication languages" : `${value.publicationLanguages.length} languages`} ·{" "}
          {value.yearFrom || value.yearTo ? `${value.yearFrom ?? "…"}–${value.yearTo ?? "…"}` : "Any year"} ·{" "}
          Top {value.limit}
        </span>
        {activeCount > 0 && (
          <span className="rounded bg-accent-blue-soft px-1.5 text-[11px] font-medium text-accent-blue">{activeCount} active</span>
        )}
        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-5 border-t px-4 py-4 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Publication languages</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={allLanguages} onCheckedChange={(c) => c && set("publicationLanguages", [])} />
                All languages
              </label>
              {PUBLICATION_LANGUAGES.map((code) => (
                <label key={code} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.publicationLanguages.includes(code)}
                    onCheckedChange={(c) => toggleLang(code, c === true)}
                  />
                  {languageLabel(code)}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              All selected languages are searched with a translated query. When a filter is set, papers without language
              metadata are excluded.
            </p>
          </fieldset>

          <div className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Publication years</legend>
              <div className="flex items-center gap-2">
                <Label htmlFor="year-from" className="sr-only">From year</Label>
                <YearInput id="year-from" value={value.yearFrom} onChange={(v) => set("yearFrom", v)} placeholder="From" />
                <span className="text-muted-foreground">–</span>
                <Label htmlFor="year-to" className="sr-only">To year</Label>
                <YearInput id="year-to" value={value.yearTo} onChange={(v) => set("yearTo", v)} placeholder="To" />
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ranking</legend>
              <RankingModeToggle value={value.mode} onChange={(m) => set("mode", m)} available={availableModes} />
              <p className="text-xs leading-relaxed text-muted-foreground">{MODE_DESCRIPTIONS[value.mode]}</p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Results</legend>
                <Segmented
                  options={RESULT_LIMITS.map((n) => [n, `Top ${n}`])}
                  value={value.limit}
                  onChange={(n) => set("limit", n)}
                />
                <p className="text-xs text-muted-foreground">
                  The most relevant papers overall. Every language may supply up to {value.limit} candidates, so any language could
                  fill the whole list; ranking alone decides the mix.
                </p>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="min-score" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Minimum relevance <span className="tabular normal-case">{value.minScore.toFixed(2)}</span>
                </Label>
                <Slider
                  id="min-score"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={[value.minScore]}
                  onValueChange={([v]) => set("minScore", v)}
                  aria-label="Minimum relevance score"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <label className={cn("flex items-center gap-2.5 text-sm", !llmAvailable && "opacity-60")}>
                <Switch checked={value.translate && llmAvailable} disabled={!llmAvailable} onCheckedChange={(c) => set("translate", c)} />
                Show machine-translated titles &amp; abstracts
              </label>
              {!llmAvailable && <p className="pl-11 text-xs text-muted-foreground">Requires GEMINI_API_KEY on the server.</p>}
              <label className="flex items-center gap-2.5 text-sm">
                <Switch checked={value.compare} onCheckedChange={(c) => set("compare", c)} />
                Compare with original-language-only search
              </label>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
