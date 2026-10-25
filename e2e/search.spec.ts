// End-to-end UI workflow. The API is mocked with SYNTHETIC test data (not real papers) so the
// test is deterministic and does not consume the OpenAlex budget.
import { expect, test, type Page } from "@playwright/test";
import type { Capabilities, QueryVariant, RankedPaper, SearchResponse } from "../lib/types";

const caps: Capabilities = { llm: false, embeddings: "ready", embeddingModel: "test-model", openalexKey: true, crossref: false };

const variants: QueryVariant[] = [
  { id: "openalex:en:0", lang: "en", kind: "original", text: "drought rice", searchQuery: "drought rice", concepts: ["drought", "rice"], topic: "drought", source: "openalex", relaxed: false, hitCount: 2, totalAvailable: 2, matchCount: 2, kept: 2, error: null, skipped: null },
  { id: "openalex:zh:1", lang: "zh", kind: "translated", text: "干旱 水稻", searchQuery: "干旱 水稻", concepts: ["干旱", "水稻"], topic: "干旱", source: "openalex", relaxed: false, hitCount: 1, totalAvailable: 1, matchCount: 1, kept: 1, error: null, skipped: null },
];

function paper(id: string, title: string, language: string | null, semanticRaw: number, keyword: number, variantId: string): RankedPaper {
  const semantic = semanticRaw;
  return {
    id,
    openalexId: null,
    doi: `10.1234/e2e.${id.toLowerCase()}`,
    title,
    authors: ["Test Author"],
    authorCount: 1,
    year: 2021,
    venue: "Test Venue",
    abstract: `Synthetic abstract for ${title}.`,
    language,
    languageTag: language,
    languageSource: "metadata",
    landingUrl: `https://example.org/${id}`,
    oaUrl: null,
    isOpenAccess: null,
    citedByCount: null,
    type: "article",
    sources: ["openalex"],
    retrievedBy: [{ variantId, rank: 1 }],
    scores: { semanticRaw, semantic, keywordRaw: keyword * 5, keyword, hybrid: 0.7 * semantic + 0.3 * keyword, matchedTerms: ["rice"] },
    explanations: [{ kind: "terms", text: "Contains query terms: rice" }],
    textUsed: "title+abstract",
  };
}

const response: SearchResponse = {
  query: "How does drought affect rice?",
  queryLanguage: "en",
  requestedMode: "hybrid",
  effectiveMode: "hybrid",
  availableModes: ["hybrid", "semantic", "keyword"],
  filters: { publicationLanguages: [], yearFrom: null, yearTo: null, limit: 100 },
  variants,
  candidateCount: 3,
  retrievedCount: 3,
  literatureEstimate: "topic",
  // Keyword favors Alpha; semantic favors Gamma (Chinese).
  papers: [
    paper("A", "TEST Alpha keyword-heavy paper", "en", 0.3, 1, "openalex:en:0"),
    paper("B", "TEST Beta balanced paper", "en", 0.6, 0.5, "openalex:en:0"),
    paper("C", "TEST Gamma 干旱胁迫 paper", "zh", 0.9, 0.1, "openalex:zh:1"),
  ],
  capabilities: caps,
  notices: [],
  weights: { semantic: 0.7, keyword: 0.3 },
  tookMs: 12,
};

async function mockApi(page: Page, search: (body: unknown) => { status: number; json: unknown }) {
  await page.route("**/api/status", (route) => route.fulfill({ json: caps }));
  await page.route("**/api/search", async (route) => {
    const r = search(route.request().postDataJSON());
    await route.fulfill({ status: r.status, json: r.json });
  });
}

async function titles(page: Page) {
  return page.locator("[data-testid=paper-card] h3").allInnerTexts();
}

test("search, switch ranking modes, and filter by language", async ({ page }) => {
  let lastBody: Record<string, unknown> | null = null;
  await mockApi(page, (body) => {
    lastBody = body as Record<string, unknown>;
    return { status: 200, json: response };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Research has no single language." })).toBeVisible();

  await page.getByLabel("Research question").fill("How does drought affect rice?");
  await page.getByLabel("Research question").press("Enter");

  await expect(page.getByTestId("paper-card")).toHaveCount(3);
  expect(lastBody).toMatchObject({ query: "How does drought affect rice?", queryLanguage: "en", mode: "hybrid", limit: 100 });
  await expect(page.getByText("of 3 candidates (from 3 retrieved)", { exact: false })).toBeVisible();

  // Hybrid order: C (0.66) > B (0.57) > A (0.51)
  expect((await titles(page))[0]).toContain("Gamma");

  const resultsHeader = page.locator("main").getByRole("radiogroup", { name: "Ranking mode" }).last();
  await resultsHeader.getByRole("radio", { name: "Keyword" }).click();
  expect((await titles(page))[0]).toContain("Alpha");

  await resultsHeader.getByRole("radio", { name: "Semantic" }).click();
  expect(await titles(page)).toEqual([
    expect.stringContaining("Gamma"),
    expect.stringContaining("Beta"),
    expect.stringContaining("Alpha"),
  ]);

  // Translated-query provenance is visible on the Chinese paper.
  await expect(page.getByTestId("paper-card").first()).toContainText("via Chinese query");

  // Language refinement from the coverage panel.
  await page.getByRole("button", { name: /Chinese · 中文/ }).click();
  await expect(page.getByTestId("paper-card")).toHaveCount(1);
  await expect(page.getByTestId("paper-card")).toHaveAttribute("data-language", "zh");
});

test("shows a clear error when the search budget is exhausted", async ({ page }) => {
  await mockApi(page, () => ({
    status: 429,
    json: { error: "OpenAlex rate limit or daily budget reached.", code: "rate_limited" },
  }));
  await page.goto("/");
  await page.getByLabel("Research question").fill("Machine learning methods for early melanoma detection");
  await page.getByLabel("Research question").press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Search limit" })).toContainText("Search limit reached");
  await expect(page.getByRole("alert").filter({ hasText: "Search limit" })).toContainText("daily budget");
});

test("shows an empty state when nothing is found", async ({ page }) => {
  await mockApi(page, () => ({ status: 200, json: { ...response, papers: [], variants: [variants[0]] } }));
  await page.goto("/");
  await page.getByLabel("Research question").fill("an obscure question");
  await page.getByLabel("Research question").press("Enter");
  await expect(page.getByText("No papers found")).toBeVisible();
});
