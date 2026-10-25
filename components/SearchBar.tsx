"use client";

import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        // Pill-shaped, outlined in the accent blue, with a faint blue tint and glow underneath.
        "group flex w-full items-center gap-2 rounded-full border-[1.5px] border-accent-brand/40 p-1.5 pl-4",
        "bg-[color-mix(in_oklch,var(--accent-brand-soft)_45%,var(--surface))]",
        "shadow-[0_12px_32px_-16px_color-mix(in_oklch,var(--accent-brand),transparent_35%)] transition-[border-color,box-shadow]",
        "focus-within:border-accent-brand focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--accent-brand),transparent_80%),0_12px_32px_-16px_color-mix(in_oklch,var(--accent-brand),transparent_35%)]",
        compact ? "h-12" : "h-14 sm:h-16",
      )}
    >
      <Search className="size-5 shrink-0 text-accent-brand/70" aria-hidden="true" />
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
      <span className="hidden shrink-0 rounded-full bg-surface/70 px-2.5 py-1 text-xs text-muted-foreground sm:inline">
        {languageLabel}
      </span>
      <Button
        type="submit"
        disabled={loading || value.trim().length < 2}
        className={cn("shrink-0 rounded-full px-4", compact ? "h-9" : "h-10 sm:h-12 sm:px-6")}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
        <span className="hidden sm:inline">{loading ? "Searching" : "Search"}</span>
      </Button>
    </form>
  );
}
