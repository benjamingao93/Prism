import "server-only";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === "true" || v === "1"));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const EnvSchema = z.object({
  GEMINI_API_KEY: optionalString,
  LLM_MODEL_FAST: z.string().default("gemini-3.8-flash"),
  LLM_MODEL_SUMMARY: z.string().default("gemini-3.8-flash"),
  /** Comma-separated models tried in order when the primary is overloaded or unreachable. */
  LLM_FALLBACK_MODELS: z.string().default("gemini-3.6-flash,gemini-3.5-flash-lite"),
  OPENALEX_API_KEY: optionalString,
  OPENALEX_MAILTO: optionalString,
  CROSSREF_ENABLED: bool(false),
  CROSSREF_MAILTO: optionalString,
  EMBEDDINGS_ENABLED: bool(true),
  EMBEDDING_MODEL: z.string().default("Xenova/paraphrase-multilingual-MiniLM-L12-v2"),
  EMBEDDING_CACHE_DIR: z.string().default(".cache/models"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Primary model followed by the configured fallbacks, without duplicates. */
export function modelChain(primary: string): string[] {
  const fallbacks = env()
    .LLM_FALLBACK_MODELS.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

let cached: Env | null = null;

/** Validated server environment. All variables are optional; features degrade when unset. */
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report variable names only — never values, which may be secrets.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  cached = parsed.data;
  return cached;
}
