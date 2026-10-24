import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "./env";

export type LlmErrorKind = "unavailable" | "rate_limited" | "refusal" | "invalid_output" | "failed";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

let client: Anthropic | null = null;

export function llmConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmError("unavailable", "ANTHROPIC_API_KEY is not configured");
  client ??= new Anthropic({ apiKey, timeout: 45_000, maxRetries: 2 });
  return client;
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
function supportsServerFallback(model: string): boolean {
  return /^claude-(sonnet-5-5|opus-5|fable-5)/.test(model);
}

export interface StructuredCallOptions {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
}

/** One Messages API call constrained to a Zod schema via structured outputs. */
export async function structuredCall<S extends z.ZodType>(schema: S, opts: StructuredCallOptions): Promise<z.infer<S>> {
  const anthropic = getClient();
  const fallback = supportsServerFallback(opts.model);
  try {
    const response = await anthropic.beta.messages.parse(
      {
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.prompt }],
        output_config: { format: betaZodOutputFormat(schema), effort: opts.effort ?? "low" },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { timeout: opts.timeoutMs ?? 45_000 },
    );
    if (response.stop_reason === "refusal") {
      throw new LlmError("refusal", "The model declined this request");
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmError("invalid_output", "The model response was truncated");
    }
    if (response.parsed_output == null) {
      throw new LlmError("invalid_output", "The model returned output that did not match the expected format");
    }
    return response.parsed_output as z.infer<S>;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new LlmError("rate_limited", "LLM rate limit reached");
    if (err instanceof Anthropic.AuthenticationError) throw new LlmError("unavailable", "LLM API key was rejected");
    if (err instanceof Anthropic.APIError) throw new LlmError("failed", `LLM request failed (HTTP ${err.status ?? "?"})`);
    throw new LlmError("failed", "LLM request failed");
  }
}
