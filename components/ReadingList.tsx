"use client";

import { Bookmark, ExternalLink, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { safeExternalUrl } from "@/lib/url";
import { useAppState } from "./AppState";
import { LanguageBadge } from "./LanguageBadge";

export function ReadingList() {
  const { saved, removeSaved, clearSaved } = useAppState();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 bg-surface" aria-label={`Reading list, ${saved.length} saved`}>
          <Bookmark className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Reading list</span>
          <span className="tabular rounded bg-secondary px-1 text-[11px] text-muted-foreground">{saved.length}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="font-serif text-lg">Reading list</SheetTitle>
          <SheetDescription>Saved in this browser only. Nothing is uploaded.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {saved.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Save papers from your results with the bookmark button.
            </p>
          ) : (
            <ul className="divide-y">
              {saved.map((p) => {
                const href = safeExternalUrl(p.landingUrl);
                return (
                  <li key={p.id} className="flex gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <LanguageBadge code={p.language} />
                        {p.year && <span className="tabular">{p.year}</span>}
                      </div>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-serif text-[15px] leading-snug hover:text-accent-brand hover:underline"
                        >
                          {p.title ?? "Untitled record"}
                          <ExternalLink className="ml-1 inline size-3 align-baseline opacity-60" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="font-serif text-[15px] leading-snug">{p.title ?? "Untitled record"}</span>
                      )}
                      {p.authors.length > 0 && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.authors.slice(0, 3).join(", ")}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => removeSaved(p.id)} aria-label="Remove from reading list">
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {saved.length > 0 && (
          <div className="border-t p-3">
            <Button variant="ghost" size="sm" onClick={clearSaved} className="text-muted-foreground">
              <Trash2 /> Clear all
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
