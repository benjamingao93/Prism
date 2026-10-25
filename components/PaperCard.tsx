"use client";

import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ExternalLink,
  FileText,
  Languages,
  Loader2,
  Network,
  Quote,
  Sparkles,
  Tag,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClientApiError, api } from "@/lib/client-api";
import { countryName } from "@/lib/countries";
import { languageName } from "@/lib/languages";
import { relevanceLabel, scoreFor } from "@/lib/ranking";
import type { ExplanationKind, PaperSummary, QueryLanguage, QueryVariant, RankedPaper, RankingMode } from "@/lib/types";
import { doiUrl, safeExternalUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { useAppState } from "./AppState";
import { LanguageBadge, paperLanguageProps } from "./LanguageBadge";

export interface PaperTranslation {
  title?: string | null;
  titleAlreadyInTarget?: boolean;
  titleStatus?: "pending" | "done" | "error";
  abstract?: string | null;
  abstractAlreadyInTarget?: boolean;
  abstractStatus?: "pending" | "done" | "error";
  model?: string;
}

const EXPLANATION_ICONS: Record<ExplanationKind, typeof Sparkles> = {
  semantic: Sparkles,
  terms: Tag,
  translated: Languages,
  multi: Network,
  "title-only": FileText,
};

function formatAuthors(authors: string[], total: number): string | null {
  if (!authors.length) return null;
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al. (${total} authors)`;
}

function RelevanceMeter({ paper, mode }: { paper: RankedPaper; mode: RankingMode }) {
  const score = scoreFor(paper, mode);
  const { label, tone } = relevanceLabel(paper, mode);
  const pct = Math.max(0, Math.min(1, score ?? 0)) * 100;
  const s = paper.scores;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex w-full flex-col items-start gap-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:w-28 sm:items-end"
          aria-label={`Relevance: ${label}, score ${score?.toFixed(2) ?? "unavailable"}. Show score breakdown.`}
        >
          <span className="flex items-baseline gap-1.5 text-xs whitespace-nowrap">
            {mode !== "semantic" && <span className="text-[10px] text-muted-foreground uppercase">relative</span>}
            <span
              className={cn(
                "font-medium",
                tone === "high" ? "text-accent-brand" : tone === "medium" ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            <span className="tabular text-muted-foreground">{score != null ? score.toFixed(2) : "–"}</span>
          </span>
          <span className="h-1 w-full overflow-hidden rounded-full bg-secondary sm:w-28">
            <span
              className={cn("block h-full rounded-full", tone === "low" ? "bg-muted-foreground/40" : "bg-accent-brand")}
              style={{ width: `${pct}%` }}
            />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="w-60 text-xs">
        <p className="mb-1.5 font-medium">Score breakdown</p>
        <dl className="tabular grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
          <dt>Semantic cosine</dt>
          <dd>{s.semanticRaw != null ? s.semanticRaw.toFixed(3) : "unavailable"}</dd>
          <dt>Semantic (normalized)</dt>
          <dd>{s.semantic != null ? s.semantic.toFixed(3) : "–"}</dd>
          <dt>BM25 (share of ideal match)</dt>
          <dd>{s.keywordRaw.toFixed(3)}</dd>
          <dt>Keyword (normalized)</dt>
          <dd>{s.keyword.toFixed(3)}</dd>
          <dt>Hybrid</dt>
          <dd>{s.hybrid != null ? s.hybrid.toFixed(3) : "–"}</dd>
        </dl>
        <p className="mt-1.5 opacity-80">Normalized scores are relative to this result set, not absolute measures of relevance.</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface PaperCardProps {
  paper: RankedPaper;
  mode: RankingMode;
  position: number;
  variants: Map<string, QueryVariant>;
  targetLang: QueryLanguage;
  translation: PaperTranslation | undefined;
  translationEnabled: boolean;
  llmAvailable: boolean;
  onTranslateAbstract: (paper: RankedPaper) => void;
}

export function PaperCard({
  paper,
  mode,
  position,
  variants,
  targetLang,
  translation,
  translationEnabled,
  llmAvailable,
  onTranslateAbstract,
}: PaperCardProps) {
  const { isSaved, toggleSaved } = useAppState();
  const [expanded, setExpanded] = useState(false);
  const [showTranslated, setShowTranslated] = useState(false);
  const [summary, setSummary] = useState<{ status: "idle" | "loading" | "done" | "error"; data?: PaperSummary; model?: string; error?: string }>({
    status: "idle",
  });

  const saved = isSaved(paper.id);
  const sourceUrl = safeExternalUrl(paper.landingUrl);
  const oaUrl = safeExternalUrl(paper.oaUrl);
  const authors = formatAuthors(paper.authors, paper.authorCount);
  const translatedTitle = translationEnabled && translation?.title ? translation.title : null;
  const translatedAbstract = translation?.abstract ?? null;
  const viaTranslated = paper.retrievedBy
    .map((r) => variants.get(r.variantId))
    .filter((v): v is QueryVariant => Boolean(v && v.kind === "translated"));

  const requestSummary = async () => {
    if (!paper.abstract) return;
    setSummary({ status: "loading" });
    try {
      const res = await api.summarize({ id: paper.id, title: paper.title, abstract: paper.abstract, targetLang });
      setSummary({ status: "done", data: res.summary, model: res.model });
    } catch (err) {
      setSummary({ status: "error", error: err instanceof ClientApiError ? err.message : "Summary failed" });
    }
  };

  const abstractText = showTranslated && translatedAbstract ? translatedAbstract : paper.abstract;

  return (
    <article
      id={`paper-${encodeURIComponent(paper.id)}`}
      data-testid="paper-card"
      data-language={paper.language ?? "unknown"}
      className="animate-fade-in-up rounded-lg border bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition-colors hover:border-foreground/15 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
            <span className="tabular w-5 text-right text-muted-foreground/70">{position}.</span>
            <LanguageBadge {...paperLanguageProps(paper)} />
            {paper.year != null && <span className="tabular">{paper.year}</span>}
            {paper.isOpenAccess && (
              <span className="rounded border border-success/30 px-1.5 py-0.5 text-[11px] leading-none text-success">Open access</span>
            )}
            {viaTranslated.length > 0 && (
              <span className="inline-flex items-center gap-1 text-accent-brand">
                <Languages className="size-3" aria-hidden="true" />
                via {viaTranslated.map((v) => languageName(v.lang)).join(" & ")} query
              </span>
            )}
          </div>

          <h3 dir="auto" className="font-serif text-[17px] leading-snug font-semibold text-foreground sm:text-lg" lang={paper.language ?? undefined}>
            {sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent-brand hover:underline decoration-1 underline-offset-2">
                {paper.title ?? "Untitled record"}
              </a>
            ) : (
              (paper.title ?? "Untitled record")
            )}
          </h3>
          {translatedTitle && (
            <p className="mt-1 text-[15px] leading-snug text-secondary-foreground" lang={targetLang}>
              <span className="mr-1.5 inline-flex translate-y-[-1px] items-center rounded bg-secondary px-1 py-0.5 align-middle text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Machine-translated
              </span>
              {translatedTitle}
            </p>
          )}
          {translationEnabled && translation?.titleStatus === "pending" && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Translating title…
            </p>
          )}

          <div className="mt-1.5 text-[13px] text-muted-foreground">
            {authors ?? <span className="italic">Authors unavailable</span>}
            {paper.venue && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="italic">{paper.venue}</span>
              </>
            )}
          </div>
        </div>

        <RelevanceMeter paper={paper} mode={mode} />
      </div>

      <div className="mt-3">
        {paper.abstract ? (
          <p
            dir="auto"
            className={cn("text-[14px] leading-relaxed text-secondary-foreground", !expanded && "line-clamp-3")}
            lang={showTranslated && translatedAbstract ? targetLang : (paper.language ?? undefined)}
          >
            {showTranslated && translatedAbstract && (
              <span className="mr-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Machine-translated
              </span>
            )}
            {abstractText}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No abstract available.</p>
        )}
      </div>

      {paper.explanations.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Why this matches">
          {paper.explanations.map((e, i) => {
            const Icon = EXPLANATION_ICONS[e.kind];
            return (
              <li key={i} className="flex items-center gap-1.5">
                <Icon className="size-3.5 shrink-0 text-accent-brand/70" aria-hidden="true" />
                {e.text}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t pt-3">
        {sourceUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" /> Open source
            </a>
          </Button>
        )}
        {oaUrl && oaUrl !== sourceUrl && (
          <Button asChild variant="ghost" size="sm">
            <a href={oaUrl} target="_blank" rel="noopener noreferrer">
              <FileText aria-hidden="true" /> Open-access copy
            </a>
          </Button>
        )}
        {paper.doi && (
          <a
            href={doiUrl(paper.doi)}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-full truncate px-1.5 font-mono text-[11px] text-muted-foreground hover:text-accent-brand hover:underline"
          >
            doi:{paper.doi}
          </a>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} aria-hidden="true" />
            {expanded ? "Less" : "Details"}
          </Button>
          <Button
            variant={saved ? "secondary" : "ghost"}
            size="sm"
            onClick={() => toggleSaved(paper)}
            aria-pressed={saved}
            aria-label={saved ? "Remove from reading list" : "Save to reading list"}
          >
            {saved ? <BookmarkCheck className="text-accent-brand" aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
            <span className="hidden sm:inline">{saved ? "Saved" : "Save"}</span>
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-4 rounded-md bg-muted/60 p-3.5 text-sm sm:p-4">
          {paper.abstract && (
            <section aria-label="Abstract translation">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Abstract</h4>
                {translatedAbstract ? (
                  <div role="group" aria-label="Abstract version" className="inline-flex rounded-md border bg-surface p-0.5 text-xs">
                    {[
                      [false, "Original"],
                      [true, `Translated (${languageName(targetLang)})`],
                    ].map(([val, label]) => (
                      <button
                        key={String(val)}
                        type="button"
                        aria-pressed={showTranslated === val}
                        onClick={() => setShowTranslated(val as boolean)}
                        className={cn("rounded px-2 py-0.5", showTranslated === val ? "bg-accent-brand-soft text-accent-brand" : "text-muted-foreground")}
                      >
                        {label as string}
                      </button>
                    ))}
                  </div>
                ) : translation?.abstractAlreadyInTarget ? (
                  <span className="text-xs text-muted-foreground">Already in {languageName(targetLang)}</span>
                ) : llmAvailable ? (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={translation?.abstractStatus === "pending"}
                    onClick={() => {
                      onTranslateAbstract(paper);
                      setShowTranslated(true);
                    }}
                  >
                    {translation?.abstractStatus === "pending" ? <Loader2 className="animate-spin" /> : <Languages />}
                    Translate to {languageName(targetLang)}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Translation unavailable (no LLM configured)</span>
                )}
                {translation?.abstractStatus === "error" && <span className="text-xs text-destructive">Translation failed</span>}
              </div>
              {translatedAbstract && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Machine translation{translation?.model ? ` by ${translation.model}` : ""}. Technical meaning may shift; consult the original.
                </p>
              )}
            </section>
          )}

          {paper.abstract && (
            <section aria-label="AI summary">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">AI summary</h4>
                {summary.status !== "done" && llmAvailable && (
                  <Button variant="outline" size="xs" onClick={requestSummary} disabled={summary.status === "loading"}>
                    {summary.status === "loading" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    Summarize abstract
                  </Button>
                )}
                {!llmAvailable && <span className="text-xs text-muted-foreground">Unavailable (no LLM configured)</span>}
                {summary.status === "error" && <span className="text-xs text-destructive">{summary.error}</span>}
              </div>
              {summary.status === "done" && summary.data && (
                <div className="mt-2 rounded-md border border-dashed bg-surface p-3">
                  <dl className="grid gap-2 text-[13px] sm:grid-cols-[9rem_1fr]">
                    {(
                      [
                        ["Research question", summary.data.researchQuestion],
                        ["Methodology", summary.data.methodology],
                        ["Main finding", summary.data.mainFinding],
                        ["Limitations", summary.data.limitations],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="font-medium text-muted-foreground">{k}</dt>
                        <dd className="text-secondary-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2.5 text-[11px] text-muted-foreground">
                    AI-generated from the abstract only{summary.model ? ` (${summary.model})` : ""}, not the full paper. Verify against the source.
                  </p>
                </div>
              )}
            </section>
          )}

          <section aria-label="Retrieval provenance">
            <h4 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Retrieved by</h4>
            <ul className="space-y-1 text-[13px]">
              {paper.retrievedBy.map((r) => {
                const v = variants.get(r.variantId);
                if (!v) return null;
                return (
                  <li key={r.variantId} className="flex flex-wrap items-baseline gap-x-2">
                    <Quote className="size-3 shrink-0 translate-y-0.5 text-muted-foreground" aria-hidden="true" />
                    <span className="font-medium">
                      {v.kind === "original" ? "Original" : languageName(v.lang)} query
                      {v.source === "crossref" ? " (Crossref)" : ""}
                    </span>
                    <span className="text-muted-foreground" lang={v.lang}>
                      “{v.searchQuery}”
                    </span>
                    <span className="tabular text-xs text-muted-foreground">rank #{r.rank}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Record metadata" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Source: {paper.sources.map((s) => (s === "openalex" ? "OpenAlex" : "Crossref")).join(" + ")}</span>
            {paper.languageSource === "detected" && (
              <span>
                Language: {languageName(paper.language)}, detected from the {paper.abstract ? "abstract" : "title"} (OpenAlex tag:{" "}
                {paper.languageTag ? languageName(paper.languageTag) : "none"})
              </span>
            )}
            {paper.type && <span>Type: {paper.type}</span>}
            {paper.country && <span>Published in: {countryName(paper.country)} (venue country)</span>}
            {paper.citedByCount != null && <span className="tabular">Cited by {paper.citedByCount} (not used in ranking)</span>}
            <span>Text scored: {paper.textUsed === "title+abstract" ? "title + abstract" : paper.textUsed === "title" ? "title only" : "none"}</span>
            {paper.openalexId && safeExternalUrl(paper.openalexId) && (
              <a href={paper.openalexId} target="_blank" rel="noopener noreferrer" className="hover:text-accent-brand hover:underline">
                OpenAlex record
              </a>
            )}
          </section>
        </div>
      )}
    </article>
  );
}
