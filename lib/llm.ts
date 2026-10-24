import "server-only";
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { env } from "./env";

export type LlmErrorKind = "unavailable" | "rate_limited" | "refusal" | "invalid_output" | "failed";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    /** True when another model may succeed (overload, rate limit, timeout, server error). */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

let client: GoogleGenAI | null = null;

export function llmConfigured(): boolean {
  return Boolean(env().GEMINI_API_KEY);
}

function getClient(): GoogleGenAI {
  const apiKey = env().GEMINI_API_KEY;
  if (!apiKey) throw new LlmError("unavailable", "GEMINI_API_KEY is not configured");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/** JSON Schema for Gemini's `responseJsonSchema`, without the `$schema` meta key. */
export function toResponseSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const BLOCKED_FINISH_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

export interface StructuredCallOptions {
  /** Models to try in order; the next one is used only when the previous is overloaded or unreachable. */
  models: string[];
  system: string;
  prompt: string;
  maxTokens: number;
  /** MINIMAL is deliberately not offered: gemini-3.8-flash rejects it with HTTP 400. */
  thinking?: "low" | "medium" | "high";
  timeoutMs?: number;
}

const THINKING: Record<NonNullable<StructuredCallOptions["thinking"]>, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/**
 * A Gemini call constrained to a Zod schema via structured JSON output, then validated.
 * Falls through `opts.models` when a model is overloaded, rate limited, or times out.
 */
export async function structuredCall<S extends z.ZodType>(
  schema: S,
  opts: StructuredCallOptions,
): Promise<{ data: z.infer<S>; model: string }> {
  let lastError: LlmError = new LlmError("unavailable", "No LLM model configured");
  for (const model of orderByAvailability(opts.models)) {
    try {
      const data = await callModel(schema, model, opts);
      cooldownUntil.delete(model);
      return { data, model };
    } catch (err) {
      if (!(err instanceof LlmError) || !err.retryable) throw err;
      lastError = err;
      cooldownUntil.set(model, Date.now() + COOLDOWN_MS);
      console.warn(`[llm] ${model} unavailable (${err.message}); trying next model`);
    }
  }
  throw lastError;
}

/**
 * Models that just failed with an overload, rate limit or timeout are moved to the end of the
 * chain for a short while, so every request doesn't wait out the same timeout before falling back.
 */
const COOLDOWN_MS = 2 * 60 * 1000;
const cooldownUntil: Map<string, number> = ((globalThis as unknown as { __babelLlmCooldown?: Map<string, number> })
  .__babelLlmCooldown ??= new Map());

export function orderByAvailability(models: string[], now = Date.now()): string[] {
  const cooling = (m: string) => (cooldownUntil.get(m) ?? 0) > now;
  return [...models.filter((m) => !cooling(m)), ...models.filter(cooling)];
}

/** For tests. */
export function resetModelCooldowns(): void {
  cooldownUntil.clear();
}

async function callModel<S extends z.ZodType>(schema: S, model: string, opts: StructuredCallOptions): Promise<z.infer<S>> {
  const gemini = getClient();
  let text: string | undefined;
  try {
    const response = await gemini.models.generateContent({
      model,
      contents: opts.prompt,
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: toResponseSchema(schema),
        maxOutputTokens: opts.maxTokens,
        thinkingConfig: { thinkingLevel: THINKING[opts.thinking ?? "low"] },
        httpOptions: {
          timeout: opts.timeoutMs ?? 30_000,
          // No SDK retries (its default is 5 attempts up to 60s apart): an overloaded model
          // is better handled by moving to the next model in the chain.
          retryOptions: { attempts: 1 },
        },
      },
    });

    if (response.promptFeedback?.blockReason) {
      throw new LlmError("refusal", "The model declined this request");
    }
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && BLOCKED_FINISH_REASONS.has(finish)) {
      throw new LlmError("refusal", "The model declined this request");
    }
    if (finish === FinishReason.MAX_TOKENS) {
      throw new LlmError("invalid_output", "The model response was truncated");
    }
    text = response.text;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err instanceof ApiError) {
      if (err.status === 429) throw new LlmError("rate_limited", `${model} rate limit reached`, true);
      if (err.status === 401 || err.status === 403) throw new LlmError("unavailable", "LLM API key was rejected");
      if (err.status === 404) throw new LlmError("failed", `${model} is not available`, true);
      throw new LlmError("failed", `${model} request failed (HTTP ${err.status})`, err.status >= 500);
    }
    // Timeouts and network errors.
    throw new LlmError("failed", `${model} did not respond`, true);
  }

  let json: unknown;
  try {
    json = JSON.parse(text ?? "");
  } catch {
    throw new LlmError("invalid_output", "The model returned output that was not valid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new LlmError("invalid_output", "The model returned output that did not match the expected format");
  }
  return parsed.data;
}
