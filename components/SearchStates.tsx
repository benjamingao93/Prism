import { AlertTriangle, BookOpenText, RotateCcw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function ResultSkeleton({ note }: { note?: string | null }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {note ?? "Expanding your question across languages and retrieving papers from OpenAlex…"}
      </p>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-surface p-5">
          <div className="mb-3 flex gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="mb-2 h-5 w-4/5" />
          <Skeleton className="mb-4 h-4 w-2/5" />
          <Skeleton className="mb-1.5 h-3.5 w-full" />
          <Skeleton className="mb-1.5 h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function InitialState() {
  const steps = [
    ["Expand", "Your question is translated into Chinese, Spanish, Japanese and Portuguese keyword queries."],
    ["Retrieve", "Each variant searches OpenAlex in its own publication language."],
    ["Rank", "Papers are scored with multilingual embeddings and BM25, then explained."],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {steps.map(([title, body], i) => (
        <div key={title} className="rounded-lg border bg-surface p-4">
          <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
            <span className="tabular flex size-5 items-center justify-center rounded bg-accent-blue-soft text-[11px] text-accent-blue">
              {i + 1}
            </span>
            {title}
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
      ))}
    </div>
  );
}

export function NoResults({ filtered, onReset }: { filtered: boolean; onReset?: () => void }) {
  return (
    <div className="rounded-lg border border-dashed bg-surface px-6 py-12 text-center">
      <SearchX className="mx-auto mb-3 size-8 text-muted-foreground/60" aria-hidden="true" />
      <h3 className="font-serif text-lg">{filtered ? "No papers match the current filters" : "No papers found"}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {filtered
          ? "Retrieved papers exist, but none pass the language or minimum-relevance filters."
          : "Try broader wording, fewer technical constraints, a wider year range, or all publication languages."}
      </p>
      {filtered && onReset && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onReset}>
          <RotateCcw /> Clear result filters
        </Button>
      )}
    </div>
  );
}

export function ErrorState({ message, code, onRetry }: { message: string; code?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="font-medium">
            {code === "rate_limited" ? "Search limit reached" : code === "invalid_request" ? "Check your search" : "Search failed"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          {code !== "invalid_request" && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              <RotateCcw /> Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SourceNote() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <BookOpenText className="size-3.5" aria-hidden="true" />
      All results are real records retrieved live from OpenAlex. Nothing shown is demo data.
    </p>
  );
}
