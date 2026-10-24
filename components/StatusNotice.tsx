import { Info, Loader2, TriangleAlert } from "lucide-react";
import type { Capabilities } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "loading"; children: React.ReactNode }) {
  const Icon = tone === "warning" ? TriangleAlert : tone === "loading" ? Loader2 : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed",
        tone === "warning" ? "border-warning/30 bg-warning/5 text-foreground" : "bg-surface text-muted-foreground",
      )}
    >
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone === "loading" && "animate-spin", tone === "warning" && "text-warning")} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** Configuration notices shown before any search, based on what the server can do. */
export function CapabilityNotices({ caps }: { caps: Capabilities | null }) {
  if (!caps) return null;
  return (
    <div className="space-y-2">
      {!caps.llm && (
        <Notice tone="warning">
          Cross-language query expansion and translation are off because no LLM is configured. Searches use your original query only.
          Set <code className="font-mono">ANTHROPIC_API_KEY</code> on the server to enable them.
        </Notice>
      )}
      {caps.embeddings === "loading" && (
        <Notice tone="loading">Loading the multilingual embedding model (first run downloads about 120 MB)…</Notice>
      )}
      {(caps.embeddings === "failed" || caps.embeddings === "disabled") && (
        <Notice tone="warning">Semantic ranking is unavailable ({caps.embeddings}). Results will be ranked by keyword match.</Notice>
      )}
      {!caps.openalexKey && (
        <Notice>
          OpenAlex is being used without an API key, which shares a small daily budget per network. A free{" "}
          <code className="font-mono">OPENALEX_API_KEY</code> raises it tenfold.
        </Notice>
      )}
    </div>
  );
}
