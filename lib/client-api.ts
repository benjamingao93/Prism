import type { GapsRequest, GapsResponse } from "./gaps";
import type {
  ApiError,
  Capabilities,
  SearchRequestInput,
  SearchResponse,
  SummarizeResponse,
  TranslateRequest,
  TranslateResponse,
} from "./types";

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly code: ApiError["code"] | "network",
    readonly status: number,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 120_000, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = rest.signal ? AbortSignal.any([rest.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(path, { ...rest, signal, headers: { "Content-Type": "application/json", ...rest.headers } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ClientApiError("The request took too long. Please try again.", "timeout", 0);
    }
    throw new ClientApiError("Could not reach the Prism server.", "network", 0);
  }
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || body == null) {
    const err = body as ApiError | null;
    throw new ClientApiError(err?.error ?? `Request failed (HTTP ${res.status})`, err?.code ?? "internal", res.status);
  }
  return body as T;
}

export const api = {
  search: (input: SearchRequestInput, signal?: AbortSignal) =>
    request<SearchResponse>("/api/search", { method: "POST", body: JSON.stringify(input), signal }),
  translate: (input: TranslateRequest, signal?: AbortSignal) =>
    request<TranslateResponse>("/api/translate", { method: "POST", body: JSON.stringify(input), signal, timeoutMs: 90_000 }),
  summarize: (input: { id: string; title: string | null; abstract: string; targetLang: string }) =>
    request<SummarizeResponse>("/api/summarize", { method: "POST", body: JSON.stringify(input), timeoutMs: 90_000 }),
  gaps: (input: GapsRequest, signal?: AbortSignal) =>
    request<GapsResponse>("/api/gaps", { method: "POST", body: JSON.stringify(input), signal, timeoutMs: 180_000 }),
  status: () => request<Capabilities>("/api/status", { method: "GET", timeoutMs: 10_000 }),
};
