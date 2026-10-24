# Babel Scholar

**Find the scientific research your language might otherwise cause you to miss.**

Babel Scholar is a multilingual research search engine. You ask a question in any of 15 languages (English, Chinese, Spanish, Portuguese, French, German, Japanese, Russian, Korean, Indonesian, Italian, Turkish, Polish, Ukrainian and Arabic). It expands the question into keyword queries in all of them, retrieves candidates from [OpenAlex](https://openalex.org) in each language, ranks the whole pool together with multilingual embeddings plus language-aware BM25, and shows the 100 most relevant papers. There is no per-language quota. Each result explains why it matched.

All results are live OpenAlex records. The app contains no demo data, and missing abstracts, DOIs and languages are shown as missing.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add GEMINI_API_KEY and OPENALEX_API_KEY
npm run dev                  # http://localhost:3000
```

On first start the server downloads the multilingual embedding model (~120 MB) into `.cache/models` in the background. Until it is ready, searches fall back to keyword ranking and say so.

## What needs configuration

| Feature | Without configuration | Enable with |
| --- | --- | --- |
| OpenAlex retrieval | Works. Keyless budget is $0.10/day, shared per IP (~100 searches) | `OPENALEX_API_KEY` (free, 10× budget) |
| Multilingual semantic ranking | Works (local model) | on by default; `EMBEDDINGS_ENABLED=false` disables |
| Keyword (BM25) ranking | Works | none needed |
| Cross-language query expansion | **Off.** Only the original query is searched, with a notice | `GEMINI_API_KEY` |
| Title/abstract translation, abstract summaries | **Off.** Controls are disabled with an explanation | `GEMINI_API_KEY` |
| Crossref supplementary results | Off | `CROSSREF_ENABLED=true` |

Each search makes one OpenAlex keyword search per language (15), plus up to two broader retries for languages with few hits, so typically 15–25 requests. With a free key (about 1,000 searches a day) that is roughly 40–60 Babel searches a day; without a key, only a handful. Narrow the publication languages in Search settings to use fewer. Source responses are cached in memory for 24 hours.

Both LLM tasks default to `gemini-3.8-flash` (Google Gemini API, structured JSON output). Override them with `LLM_MODEL_FAST` / `LLM_MODEL_SUMMARY`. If a model is overloaded, rate limited or times out, the next model in `LLM_FALLBACK_MODELS` (default `gemini-3.6-flash,gemini-3.5-flash-lite`) is tried, and translations and summaries report which model produced them.

## How it works

1. **Expand:** Gemini turns the question into 2–5 keyword concepts per language, ordered by importance. The original query is always kept. (`lib/query-expansion.ts`)
2. **Retrieve:** one OpenAlex `search.title_and_abstract` request per variant, up to 40 candidates each (search depth 20/40/80). Translated variants are restricted to their own `language:` tag. Year and language filters are applied server-side. A sparse query (fewer than 5 hits) is broadened to its two most essential terms, then to the core term (at most two extra requests). (`lib/openalex.ts`, `lib/search.ts`)
3. **Merge and select:** papers are deduplicated by DOI, then OpenAlex ID, then exact normalized title plus year. Records with conflicting DOIs are never merged. Per-variant provenance is kept. All candidates are ranked together and the top 100 (25/50/100) are returned, with no per-language quota. (`lib/deduplication.ts`, `selectTopResults` in `lib/ranking.ts`)
4. **Score:**
   - Cosine similarity between the question (the average embedding of the original and all its translations) and each paper's title + abstract, embedded with `paraphrase-multilingual-MiniLM-L12-v2` via Transformers.js. (`lib/embeddings.ts`)
   - BM25 using ICU word segmentation (handles CJK), taking each paper's best score over all query variants. (`lib/bm25.ts`, `lib/tokenize.ts`)
   - Hybrid = 0.7 · semantic + 0.3 · keyword after min-max normalization. (`lib/ranking.ts`)
5. **Explain and present:** explanations come only from computed facts. Translations are labeled and shown next to the original. Coverage stats and the baseline comparison are computed from the actual result set. (`lib/comparison.ts`)

The sanity check of cross-language similarity (`npm run check:embeddings`) shows the following cosines against the drought/rice question. These are seven sentences, not a benchmark:

| Text | Cosine |
| --- | --- |
| English paraphrase | 0.95 |
| Chinese translation | 0.86 |
| Portuguese translation | 0.83 |
| Spanish translation | 0.83 |
| Japanese translation | 0.71 |
| Unrelated topics | about 0 |

## Project layout

```
app/                  pages (/, /how-it-works, /about) and API routes
  api/search          validate → expand → retrieve → merge → score → JSON
  api/translate       batch title/abstract translation (cached, skips text already in target language)
  api/summarize       abstract-only structured summary
  api/status          capability flags (LLM, embeddings state, keys present)
components/           UI (SearchExperience, PaperCard, SearchCoverage, ComparisonPanel, ...)
lib/                  retrieval, ranking, translation and shared types; no UI code
tests/unit            Vitest suites with mocked APIs
tests/live            opt-in live check against real OpenAlex (npm run test:live)
e2e/                  Playwright workflow tests with mocked API responses
```

## Scripts

```bash
npm run dev               # development server
npm run build && npm start
npm run lint
npm run typecheck
npm test                  # unit tests (mocked; no network)
npm run test:e2e          # Playwright, desktop + mobile (mocked API)
npm run test:live         # real OpenAlex + local model, hand-written query variants (uses API budget)
npm run check:embeddings  # cross-language similarity sanity check
```

## Limitations

- Coverage is limited to OpenAlex. Regional journals, theses and non-DOI literature are underrepresented.
- OpenAlex language tags are machine-detected and sometimes wrong. Some `zh`-tagged works have English-only metadata.
- Many records lack abstracts. Those are scored on titles only and labeled as such.
- Each language contributes at most 20–80 candidates (the search depth), so results are a sample, not an exhaustive search.
- Many records in some languages (notably Japanese) have no abstract in OpenAlex; they are ranked on titles alone and labeled.
- A fresh search ranks several hundred candidates on the CPU and takes roughly 10–20 seconds; repeats are cached.
- Machine-translated queries can shift technical meaning. Every variant is shown in the UI.
- Ranking is multilingual but not perfectly language-neutral (see the Japanese similarity above).
- The in-memory caches reset when the server restarts. The reading list lives in browser `localStorage`.
