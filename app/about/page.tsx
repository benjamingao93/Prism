import type { Metadata } from "next";
import { PrismLockup } from "@/components/Logo";

export const metadata: Metadata = { title: "About — Prism" };

const SOURCES = [
  ["OpenAlex", "https://openalex.org", "Primary source of scholarly metadata (CC0). Searched live on every query."],
  ["Crossref", "https://www.crossref.org", "Optional supplementary source, off by default (CROSSREF_ENABLED)."],
  [
    "paraphrase-multilingual-MiniLM-L12-v2",
    "https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "Multilingual sentence embeddings, run locally via Transformers.js (ONNX).",
  ],
  ["Gemini (Google)", "https://ai.google.dev", "Query expansion, translation and abstract summaries, when an API key is configured."],
] as const;

export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <PrismLockup showTagline className="mb-8" />
      <p className="text-sm text-muted-foreground">About</p>
      <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
        Find the research your language might otherwise cause you to miss.
      </h1>
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-secondary-foreground">
        <p>
          Science is published in many languages, but most discovery happens through English queries. A question about drought and
          rice yields will miss papers that describe the same experiments as 干旱胁迫 and 水稻产量, or sequía and rendimiento del arroz.
          Translation tools help you read what you have already found. Prism is meant to help you find it in the first place: one question, every language.
        </p>
        <p>
          It is a research prototype. It searches a real, public index and shows its work: which queries ran, which ones found each
          paper, and how each score was computed.
        </p>
      </div>

      <h2 className="mt-10 font-serif text-xl font-semibold">Principles</h2>
      <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-secondary-foreground">
        <li><strong className="font-medium text-foreground">Real data only.</strong> Every result is a live OpenAlex record. Nothing is demo data, and missing abstracts, DOIs or languages are shown as missing, never filled in.</li>
        <li><strong className="font-medium text-foreground">Originals first.</strong> Machine translations are labeled and shown alongside the original text, never silently in its place.</li>
        <li><strong className="font-medium text-foreground">Languages you can check.</strong> Language badges come from OpenAlex. When a paper’s text contradicts its tag, Gemini confirms the correction, and the badge turns dashed and names the original tag.</li>
        <li><strong className="font-medium text-foreground">No language penalty.</strong> Publication language, venue prestige, citations and author nationality are not ranking signals.</li>
        <li><strong className="font-medium text-foreground">Honest coverage.</strong> Results are a sample, and “additional papers found” are not claimed to be relevant or to have been missed by any other tool.</li>
        <li><strong className="font-medium text-foreground">Private by default.</strong> Your reading list lives in your browser’s local storage. API keys stay on the server.</li>
      </ul>

      <h2 className="mt-10 font-serif text-xl font-semibold">Data and models</h2>
      <dl className="mt-3 divide-y rounded-lg border bg-surface">
        {SOURCES.map(([name, href, desc]) => (
          <div key={name} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr]">
            <dt>
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:text-accent-blue hover:underline">
                {name}
              </a>
            </dt>
            <dd className="text-sm text-muted-foreground">{desc}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        Prism does not scrape Google Scholar or any other search engine, and it does not access full text.
      </p>
    </div>
  );
}
