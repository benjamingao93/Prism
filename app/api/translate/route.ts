import { errorResponse, llmErrorResponse, parseBody } from "@/lib/api";
import { env } from "@/lib/env";
import { llmConfigured } from "@/lib/llm";
import { translate } from "@/lib/server";
import { TranslateRequestSchema, type TranslateResponse } from "@/lib/types";

export const maxDuration = 90;

export async function POST(request: Request) {
  if (!llmConfigured()) {
    return errorResponse(503, {
      error: "Translation is unavailable: no LLM is configured (set GEMINI_API_KEY).",
      code: "llm_unavailable",
    });
  }
  const body = await parseBody(request, TranslateRequestSchema);
  if ("response" in body) return body.response;

  try {
    const items = await translate(body.data);
    const response: TranslateResponse = { targetLang: body.data.targetLang, model: env().LLM_MODEL_FAST, items };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return llmErrorResponse(err);
  }
}
