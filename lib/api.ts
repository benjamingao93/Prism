import "server-only";
import type { z } from "zod";
import { LlmError } from "./llm";
import type { ApiError } from "./types";

export function errorResponse(status: number, body: ApiError): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const MAX_BODY_BYTES = 64 * 1024;

/** Parse and validate a JSON request body. Returns the data or an error Response. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.output<S> } | { response: Response }> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return { response: errorResponse(413, { error: "Request body too large", code: "invalid_request" }) };
    }
    raw = JSON.parse(text);
  } catch {
    return { response: errorResponse(400, { error: "Request body must be valid JSON", code: "invalid_request" }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      response: errorResponse(400, {
        error: parsed.error.issues[0]?.message ?? "Invalid request",
        code: "invalid_request",
        details: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      }),
    };
  }
  return { data: parsed.data };
}

export function llmErrorResponse(err: unknown): Response {
  if (err instanceof LlmError) {
    const status = err.kind === "unavailable" ? 503 : err.kind === "rate_limited" ? 429 : 502;
    return errorResponse(status, {
      error: err.message,
      code: err.kind === "rate_limited" ? "rate_limited" : "llm_unavailable",
    });
  }
  console.error("[api] unexpected error:", err instanceof Error ? err.message : err);
  return errorResponse(500, { error: "Unexpected server error", code: "internal" });
}
