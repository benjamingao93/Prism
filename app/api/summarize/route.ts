import { errorResponse, llmErrorResponse, parseBody } from "@/lib/api";
import { llmConfigured } from "@/lib/llm";
import { summarizeAbstract } from "@/lib/summary";
import { SummarizeRequestSchema, type SummarizeResponse } from "@/lib/types";

export const maxDuration = 90;

export async function POST(request: Request) {
  if (!llmConfigured()) {
    return errorResponse(503, {
      error: "Summaries are unavailable: no LLM is configured (set ANTHROPIC_API_KEY).",
      code: "llm_unavailable",
    });
  }
  const body = await parseBody(request, SummarizeRequestSchema);
  if ("response" in body) return body.response;

  try {
    const { summary, model } = await summarizeAbstract(body.data);
    const response: SummarizeResponse = { id: body.data.id, model, summary };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return llmErrorResponse(err);
  }
}
