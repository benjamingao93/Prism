import { errorResponse, parseBody } from "@/lib/api";
import { runSearch, SearchFailedError } from "@/lib/search";
import { searchDeps } from "@/lib/server";
import { SearchRequestSchema } from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await parseBody(request, SearchRequestSchema);
  if ("response" in body) return body.response;

  try {
    const result = await runSearch(body.data, searchDeps());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof SearchFailedError) {
      const status = err.code === "rate_limited" ? 429 : err.code === "timeout" ? 504 : 502;
      return errorResponse(status, { error: err.message, code: err.code });
    }
    console.error("[search] unexpected error:", err instanceof Error ? err.message : err);
    return errorResponse(500, { error: "Search failed unexpectedly. Please try again.", code: "internal" });
  }
}
