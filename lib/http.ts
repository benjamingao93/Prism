export type UpstreamErrorKind = "rate_limited" | "timeout" | "http" | "network" | "invalid_response";

export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly kind: UpstreamErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface FetchJsonOptions {
  service: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  return Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 200);
}

/**
 * GET a JSON resource with a per-attempt timeout, retrying 429 and 5xx with backoff
 * (honoring Retry-After). Throws UpstreamError on final failure. Never includes the URL
 * in error messages, since URLs may carry API keys.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const { service, timeoutMs = 12_000, retries = 2, headers = {} } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;

  let lastError: UpstreamError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { Accept: "application/json", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      lastError = new UpstreamError(
        service,
        isTimeout ? "timeout" : "network",
        isTimeout ? `${service} did not respond in time` : `Could not reach ${service}`,
      );
      if (attempt < retries) {
        await sleep(retryDelayMs(attempt, null));
        continue;
      }
      throw lastError;
    }

    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        throw new UpstreamError(service, "invalid_response", `${service} returned malformed JSON`, res.status);
      }
    }

    const retryable = res.status === 429 || res.status >= 500;
    lastError =
      res.status === 429
        ? new UpstreamError(service, "rate_limited", `${service} rate limit or daily budget exceeded`, 429)
        : new UpstreamError(service, "http", `${service} responded with HTTP ${res.status}`, res.status);
    if (retryable && attempt < retries) {
      await sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
      continue;
    }
    throw lastError;
  }
  throw lastError ?? new UpstreamError(service, "network", `Could not reach ${service}`);
}
