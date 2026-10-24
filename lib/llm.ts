import "server-only";
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
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
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  thinking?: "minimal" | "low" | "medium" | "high";
  timeoutMs?: number;
}

const THINKING: Record<NonNullable<StructuredCallOptions["thinking"]>, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/** One Gemini call constrained to a Zod schema via structured JSON output, then validated. */
export async function structuredCall<S extends z.ZodType>(schema: S, opts: StructuredCallOptions): Promise<z.infer<S>> {
  const gemini = getClient();
  let text: string | undefined;
  try {
    const response = await gemini.models.generateContent({
      model: opts.model,
      contents: opts.prompt,
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: toResponseSchema(schema),
        maxOutputTokens: opts.maxTokens,
        thinkingConfig: { thinkingLevel: THINKING[opts.thinking ?? "low"] },
        httpOptions: {
          timeout: opts.timeoutMs ?? 45_000,
          // The SDK default (5 attempts, up to 60s apart) is too slow for an interactive search.
          retryOptions: { attempts: 3, initialDelay: 0.5, maxDelay: 4 },
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
      if (err.status === 429) throw new LlmError("rate_limited", "LLM rate limit reached");
      if (err.status === 401 || err.status === 403) throw new LlmError("unavailable", "LLM API key was rejected");
      throw new LlmError("failed", `LLM request failed (HTTP ${err.status})`);
    }
    throw new LlmError("failed", "LLM request failed");
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
