import { Globe2 } from "lucide-react";
import { languageLabel } from "@/lib/languages";
import { cn } from "@/lib/utils";

/** Publication language as reported by source metadata. Never inferred from authors or venue. */
export function LanguageBadge({ code, className }: { code: string | null; className?: string }) {
  const unknown = !code;
  return (
    <span
      title={unknown ? "The source did not report a publication language" : "Publication language (source metadata)"}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        unknown
          ? "border-dashed border-border text-muted-foreground"
          : code === "en"
            ? "border-border bg-secondary text-secondary-foreground"
            : "border-accent-blue/20 bg-accent-blue-soft text-accent-blue",
        className,
      )}
    >
      <Globe2 className="size-3" aria-hidden="true" />
      {languageLabel(code)}
    </span>
  );
}
