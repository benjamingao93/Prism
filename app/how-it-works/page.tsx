import type { Metadata } from "next";
import { HYBRID_WEIGHTS, SEMANTIC_THRESHOLDS } from "@/lib/ranking";

export const metadata: Metadata = { title: "How It Works — Babel Scholar" };

// Measured with `npm run check:embeddings` (scripts/embedding-check.mjs), quantized model, Node.
// Query: "How does drought stress affect rice crop yields?"
const SANITY_CHECK = [
  ["English paraphrase", "Effects of drought stress on rice grain yield", 0.951],
  ["Chinese", "干旱胁迫对水稻产量的影响", 0.863],
  ["Portuguese", "Efeitos do estresse hídrico na produtividade do arroz", 0.832],
  ["Spanish", "Efectos del estrés hídrico en el rendimiento del arroz", 0.826],
  ["Japanese", "干ばつストレスがイネの収量に与える影響", 0.71],
  ["Unrelated (Chinese)", "城市空气污染与儿童哮喘", 0.039],
  ["Unrelated (English)", "Deep learning for melanoma detection in dermoscopic images", -0.034],
] as const;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-t py-6 sm:grid-cols-[3rem_1fr]">
      <span className="tabular font-serif text-2xl text-accent-blue">{String(n).padStart(2, "0")}</span>
      <div>
        <h2 className="font-serif text-xl font-semibold">{title}</h2>
        <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-secondary-foreground">{children}</div>
      </div>
    </section>
  );
}

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm text-muted-foreground">How It Works</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">From one question to many literatures</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        Babel Scholar is a retrieval-and-ranking pipeline over public scholarly metadata. Every step below runs on each search, and
        each result card shows which steps it passed through.
      </p>

      <div className="mt-8">
        <Step n={1} title="Expand the question across languages">
          <p>
            A language model (Claude, when configured) turns your question into short keyword queries in Chinese, Spanish, Japanese,
            Portuguese and English, using the terminology papers in each language tend to use. Your original question is always kept and
            searched too.
          </p>
          <p>
            Translations are machine-generated, and technical meaning can shift between languages. Every query variant is shown in the
            Search coverage panel. Without an LLM, only the original query is searched, and the interface says so.
          </p>
        </Step>

        <Step n={2} title="Retrieve from OpenAlex, per language">
          <p>
            Each variant becomes one OpenAlex title-and-abstract search. A translated query is restricted to papers whose OpenAlex
            language tag matches it, so the Chinese query looks for Chinese-language papers. Year and publication-language filters are
            sent to the API. If a strict query returns fewer than five papers, it is retried once with its least essential term removed.
          </p>
          <p>
            Responses are cached for 24 hours. Publication language comes from OpenAlex metadata, which is itself detected
            automatically, and is never inferred from author names or affiliations.
          </p>
        </Step>

        <Step n={3} title="Merge and deduplicate">
          <p>
            Results are merged by normalized DOI, then OpenAlex ID, then an exact normalized title match with the same publication year.
            Records with different DOIs are never merged. Each paper keeps a list of every query variant that retrieved it and at what
            rank. That list drives the “via Chinese query” labels and the coverage statistics.
          </p>
        </Step>

        <Step n={4} title="Score with multilingual embeddings and BM25">
          <p>
            <strong className="font-medium text-foreground">Semantic:</strong> your original question and each paper’s title and abstract
            are embedded with <code className="font-mono text-sm">paraphrase-multilingual-MiniLM-L12-v2</code>, a sentence-transformer
            trained to place paraphrases in 50+ languages near each other. It runs locally on the server. Score = cosine similarity.
            Long abstracts are truncated to roughly the model’s training length (about 128 tokens). Papers without an abstract are scored
            on their title and labeled as such.
          </p>
          <p>
            <strong className="font-medium text-foreground">Keyword:</strong> BM25 (k1 = 1.2, b = 0.75) over titles and abstracts. Text is
            segmented with ICU word boundaries, which handle Chinese and Japanese words rather than single characters. Each paper is
            scored against every query variant and keeps its best score, so a Spanish paper is matched against the Spanish query.
          </p>
          <p>
            <strong className="font-medium text-foreground">Hybrid:</strong> {HYBRID_WEIGHTS.semantic} × semantic + {HYBRID_WEIGHTS.keyword}{" "}
            × keyword, after min-max normalizing both within the result set. These weights are tunable starting values, not validated
            constants. Publication language, venue, citation counts and author information are never used in scoring.
          </p>
        </Step>

        <Step n={5} title="Explain, translate, compare">
          <p>
            Explanations are generated only from computed facts. “Strong semantic match” means cosine ≥ {SEMANTIC_THRESHOLDS.strong}, and
            “moderate” means ≥ {SEMANTIC_THRESHOLDS.moderate}. Those thresholds are heuristics for this model. The other explanations are
            the matched query terms, the query variants that retrieved the paper, and whether only the title was available.
          </p>
          <p>
            Titles and abstracts can be machine-translated into your query language. Translations are always labeled and shown
            alongside the original, never in place of it. Optional AI summaries use only the abstract and say “Not stated in the
            abstract” rather than guessing.
          </p>
          <p>
            Comparison mode ranks the original-language query’s results and the full multilingual pool with the same scores, then shows
            their top-10 overlap and the papers that only the multilingual search found. Additional papers are not necessarily relevant.
          </p>
        </Step>
      </div>

      <section className="mt-4 rounded-lg border bg-surface p-5">
        <h2 className="font-serif text-lg font-semibold">Evidence: cross-language similarity sanity check</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cosine similarity between “How does drought stress affect rice crop yields?” and short texts, using the same model and
          settings as the app. This is a seven-sentence sanity check, not a retrieval benchmark. Reproduce it with{" "}
          <code className="font-mono">npm run check:embeddings</code>.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Text</th>
                <th className="py-2 pr-3 font-medium">Language</th>
                <th className="py-2 text-right font-medium">Cosine</th>
              </tr>
            </thead>
            <tbody>
              {SANITY_CHECK.map(([lang, text, score]) => (
                <tr key={text} className="border-b last:border-0">
                  <td className="py-2 pr-3">{text}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{lang}</td>
                  <td className="tabular py-2 text-right">{score.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Translations of the same idea score 0.71–0.86, and unrelated topics score near zero. Japanese scores lowest, so ranking is
          multilingual but not perfectly language-neutral.
        </p>
      </section>

      <section className="mt-8 space-y-2 text-sm leading-relaxed text-muted-foreground">
        <h2 className="font-serif text-lg font-semibold text-foreground">Known limitations</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Coverage is limited to what OpenAlex indexes. Many regional journals, theses and non-DOI literature are missing.</li>
          <li>OpenAlex language tags are machine-detected and sometimes wrong. Some papers tagged Chinese have English-only metadata.</li>
          <li>Many records lack abstracts. Those are scored on titles alone, which are short and can inflate or deflate similarity.</li>
          <li>Each query variant retrieves a limited page of results (10–50), so this is a sample, not an exhaustive search.</li>
          <li>Scores are relative within a result set and say nothing about a paper’s scientific quality.</li>
        </ul>
      </section>
    </div>
  );
}
