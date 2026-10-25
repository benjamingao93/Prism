import { Globe2, ScanText } from "lucide-react";
import { languageLabel, languageName } from "@/lib/languages";
import { cn } from "@/lib/utils";

/**
 * A paper's language. By default this is the source's tag; when the text was checked and found
 * to be in another language, `correctedFrom` holds the original tag and the badge says so.
 * Never inferred from authors or venue.
 */
export function LanguageBadge({
  code,
  correctedFrom,
  className,
}: {
  code: string | null;
  /** Original source tag when the language was corrected from the text (null if it had none). */
  correctedFrom?: string | null;
  className?: string;
}) {
  const unknown = !code;
  const corrected = correctedFrom !== undefined;
  const title = unknown
    ? "The source did not report a language"
    : corrected
      ? `Detected from the paper's text by Gemini. OpenAlex tag: ${correctedFrom ? languageName(correctedFrom) : "none"}.`
      : "Language as tagged by OpenAlex";
  const Icon = corrected ? ScanText : Globe2;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        unknown
          ? "border-dashed border-border text-muted-foreground"
          : code === "en"
            ? "border-border bg-secondary text-secondary-foreground"
            : "border-accent-brand/20 bg-accent-brand-soft text-accent-brand",
        corrected && "border-dashed",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {languageLabel(code)}
      {corrected && <span className="sr-only"> (detected from text; OpenAlex tag {correctedFrom ? languageName(correctedFrom) : "none"})</span>}
    </span>
  );
}

/** Props for a paper's badge: passes the original tag only when the language was corrected. */
export function paperLanguageProps(p: { language: string | null; languageTag: string | null; languageSource: string }) {
  return { code: p.language, correctedFrom: p.languageSource === "detected" ? p.languageTag : undefined };
}
