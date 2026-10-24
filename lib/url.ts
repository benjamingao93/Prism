/** Return the URL only if it parses as http(s); otherwise null. Prevents javascript:, data:, etc. */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Canonical lowercase DOI (`10.xxxx/...`) from any common representation, or null. */
export function normalizeDoi(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let doi = raw.trim();
  try {
    doi = decodeURIComponent(doi);
  } catch {
    // keep as-is
  }
  doi = doi
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

export function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}
