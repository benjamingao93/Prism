"use client";

import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const EXAMPLE_QUERIES = [
  "How do microplastics affect marine ecosystems?",
  "Machine learning methods for early melanoma detection",
  "Drought-resistant rice varieties and agricultural adaptation",
  "Effects of urban air pollution on childhood asthma",
];

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  languageLabel: string;
  compact?: boolean;
}

export function SearchBar({ value, onChange, onSubmit, loading, languageLabel, compact }: SearchBarProps) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={cn(
        "group flex w-full items-center gap-2 rounded-xl border border-input bg-surface p-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-shadow focus-within:border-ring focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring),transparent_75%)]",
        compact ? "h-12" : "h-14 sm:h-16",
      )}
    >
      <Search className="ml-2.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <label htmlFor="search-input" className="sr-only">
        Research question
      </label>
      <input
        id="search-input"
        type="search"
        dir="auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="How does drought stress affect rice crop yields?"
        maxLength={500}
        autoComplete="off"
        enterKeyHint="search"
        className={cn(
          "min-w-0 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground/70 [&::-webkit-search-cancel-button]:hidden",
          compact ? "text-[15px]" : "text-base sm:text-lg",
        )}
      />
      <span className="hidden shrink-0 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground sm:inline">
        {languageLabel}
      </span>
      <Button
        type="submit"
        disabled={loading || value.trim().length < 2}
        className={cn("shrink-0 rounded-lg px-4", compact ? "h-9" : "h-10 sm:h-12 sm:px-5")}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
        <span className="hidden sm:inline">{loading ? "Searching" : "Search"}</span>
      </Button>
    </form>
  );
}

export function ExampleQueries({ onPick, disabled }: { onPick: (q: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Try:</span>
      {EXAMPLE_QUERIES.map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q)}
          className="rounded-full border bg-surface px-3 py-1 text-left text-[13px] text-secondary-foreground transition-colors hover:border-accent-blue/40 hover:text-accent-blue disabled:opacity-50"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
