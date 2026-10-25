import { errorResponse, llmErrorResponse, parseBody } from "@/lib/api";
import { GapAnalysisError, runGapAnalysis } from "@/lib/gap-analysis";
import { GapsRequestSchema } from "@/lib/gaps";
import { llmConfigured } from "@/lib/llm";
import { gapDeps } from "@/lib/server";

export const maxDuration = 180;

export async function POST(request: Request) {
  if (!llmConfigured()) {
    return errorResponse(503, {
      error: "Language gaps need an LLM to read the papers, and none is configured (set GEMINI_API_KEY).",
      code: "llm_unavailable",
    });
  }
  const body = await parseBody(request, GapsRequestSchema);
  if ("response" in body) return body.response;

  try {
    const result = await runGapAnalysis(body.data, gapDeps());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof GapAnalysisError) {
      return errorResponse(err.code === "rate_limited" ? 429 : 502, { error: err.message, code: err.code });
    }
    return llmErrorResponse(err);
  }
}
