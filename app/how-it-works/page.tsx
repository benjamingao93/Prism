import type { Metadata } from "next";
import { HYBRID_WEIGHTS, SEMANTIC_THRESHOLDS } from "@/lib/ranking";

export const metadata: Metadata = { title: "How It Works — Prism" };

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
        Prism is a retrieval-and-ranking pipeline over public scholarly metadata. Every step below runs on each search, and
        each result card shows which steps it passed through.
      </p>

      <div className="mt-8">
        <Step n={1} title="Expand the question across languages">
          <p>
            A language model (Gemini, when configured) turns your question into short keyword queries in 15 languages (English, Chinese, Spanish, Portuguese, French, German, Japanese, Russian, Korean, Indonesian, Italian, Turkish, Polish, Ukrainian and Arabic),
            using the terminology papers in each language tend to use. These are the largest abstract-bearing literatures in OpenAlex
            that the embedding model supports. Your original question is always kept and searched too.
          </p>
          <p>
            Translations are machine-generated, and technical meaning can shift between languages. Every query variant is shown in the
            Search coverage panel. Without an LLM, only the original query is searched, and the interface says so.
          </p>
        </Step>

        <Step n={2} title="Retrieve from OpenAlex, per language">
          <p>
            Each variant becomes one OpenAlex title-and-abstract search that retrieves up to 100 candidates: as many as the results
            list holds, so any single language could fill the whole list on its own. No language is capped below that. A translated query is restricted to papers whose OpenAlex language tag matches it, so the Chinese
            query looks for Chinese-language papers. Year and publication-language filters are sent to the API. If a query returns fewer than five papers, it is broadened step by step to its two most essential terms, then to the single core term. Ranking then reorders the broader set by relevance.
          </p>
          <p>
            Responses are cached for 24 hours. A paper’s language starts as OpenAlex’s tag, which OpenAlex detects automatically
            and sometimes gets wrong. A local detector flags papers whose abstract (or title) disagrees with their tag, unless the title
            itself is in the tagged language (many non-English journals add an English abstract), and Gemini reads those texts in
            one batch. Only when Gemini confirms a different language is the tag overridden. The badge is then
            dashed, and its tooltip names OpenAlex’s original tag. Language is never inferred from author names, venues or
            affiliations, and it never affects ranking.
          </p>
        </Step>

        <Step n={3} title="Merge, deduplicate, and pick the top results">
          <p>
            Results are merged by normalized DOI, then OpenAlex ID, then an exact normalized title match with the same publication year.
            Records with different DOIs are never merged. Each paper keeps a list of every query variant that retrieved it and at what
            rank. That list drives the “via Chinese query” labels and the coverage statistics.
          </p>
          <p>
            Candidates are then drawn from each language in proportion to how much literature it has on the topic. Gemini names the
            question’s most distinctive subject term in every language (asthma, 哮喘, asma, …), and one OpenAlex request counts the
            works in each language that match any of them. If that request fails, each language’s overall share of OpenAlex is used. This is relevant-document distribution estimation, as used in federated
            search. Each language keeps at least its two best matches. Equal numbers per language would oversample small
            literatures: for “Shakespeare”, English has about 99,000 matches and Italian about 1,100, and equal shares would let
            Italian fill as much of the list as English whenever relevance can’t tell papers apart. All kept candidates are then
            scored together and the top 100 (or 25 or 50) are shown, so the mix reflects where the research is.
          </p>
        </Step>

        <Step n={4} title="Score with multilingual embeddings and BM25">
          <p>
            <strong className="font-medium text-foreground">Semantic:</strong> your question (embedded in every language it was translated into, then averaged) and each paper’s title and abstract
            are embedded with <code className="font-mono text-sm">paraphrase-multilingual-MiniLM-L12-v2</code>, a sentence-transformer
            trained to place paraphrases in 50+ languages near each other. It runs locally on the server. Score = cosine similarity.
            Text is truncated to 128 tokens, the model’s training length, as in its reference configuration. When there are more than three times as many candidates as results, a fast title-only pass first shortlists the top three times as many under any ranking mode, without regard to language; the shortlist is then scored on title and abstract. Each paper is scored on the better of its title alone and its title plus abstract, because abstracts add methods and numbers that dilute similarity. Scoring only title plus abstract would rank papers without an abstract above comparable papers that have one.
          </p>
          <p>
            <strong className="font-medium text-foreground">Keyword:</strong> BM25 (k1 = 1.2, b = 0.75) over titles and abstracts. Text is
            segmented with ICU word boundaries, which handle Chinese and Japanese words rather than single characters. Each paper is
            scored against every query variant and keeps its best score, so a Spanish paper is matched against the Spanish query.
            Each score is divided by that query’s maximum possible score, giving the share of an ideal match on the same 0–1 scale in
            every language. Without this, the rarity of each language’s words in a mostly-English pool would inflate every
            non-English score. Length is compared only among papers of the same kind (title-only or title plus abstract), and scoring
            always uses all of a language’s concepts, even when its search was broadened.
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

      <section className="mt-2 border-t py-6">
        <h2 className="font-serif text-xl font-semibold">The map</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-secondary-foreground">
          The Map tab shows where the top results of your latest search were published. Each result’s venue (journal, repository
          or publisher) is looked up in OpenAlex, 100 venues per request, and countries are shaded by how many results came from
          venues registered there. The shading uses a square-root scale so countries with a few papers stay visible. This is the
          venue’s country, not the authors’ location or the paper’s language. Clicking a country returns to your results with a
          publication-country filter, without searching again.
        </p>
      </section>

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
          <li>
            Language corrections judge the title and abstract, not the full text. A paper whose title and abstract are both in
            another language than its tag is relabeled; one with a native-language title keeps its tag.
          </li>
          <li>Many records lack abstracts. Those are scored on titles alone, which are short and can inflate or deflate similarity.</li>
          <li>Each language contributes at most 100 candidates (OpenAlex’s own top matches), so this is a sample, not an exhaustive search.</li>
          <li>
            Literature sizes are estimated from OpenAlex counts for a machine-translated subject term. They depend on the term chosen
            and on OpenAlex’s language tags, which are themselves machine-detected.
          </li>
          <li>
            Large candidate pools are shortlisted using titles before full scoring. A paper with an uninformative title but a
            highly relevant abstract can occasionally miss the shortlist.
          </li>
          <li>Scores are relative within a result set and say nothing about a paper’s scientific quality.</li>
        </ul>
      </section>
    </div>
  );
}
