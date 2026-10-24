import "server-only";
import { z } from "zod";
import { globalCache } from "./cache";
import { env } from "./env";
import { languageName } from "./languages";
import { structuredCall } from "./llm";
import type { PaperSummary, QueryLanguage } from "./types";

export const NOT_STATED = "Not stated in the abstract.";

const SummarySchema = z.object({
  research_question: z.string(),
  methodology: z.string(),
  main_finding: z.string(),
  limitations: z.string(),
});

const cache = globalCache<PaperSummary>("summaries", 1000, 7 * 24 * 60 * 60 * 1000);

export async function summarizeAbstract(input: {
  id: string;
  title: string | null;
  abstract: string;
  targetLang: QueryLanguage;
}): Promise<{ summary: PaperSummary; model: string }> {
  const model = env().LLM_MODEL_SUMMARY;
  const key = `${model}|${input.targetLang}|${input.id}|${input.abstract.length}`;
  const hit = cache.get(key);
  if (hit) return { summary: hit, model };

  const notStated = input.targetLang === "en" ? NOT_STATED : `"${NOT_STATED}" translated into ${languageName(input.targetLang)}`;
  const out = await structuredCall(SummarySchema, {
    model,
    maxTokens: 4000,
    thinking: "low",
    timeoutMs: 60_000,
    system: `You summarize scientific paper abstracts for researchers. You only have the title and abstract — not the full paper.
Write each field in ${languageName(input.targetLang)}, in one or two plain sentences.
Use only information explicitly stated in the abstract. Never infer methods, sample sizes, results, or limitations that are not stated.
If the abstract does not state something, write exactly: ${notStated}`,
    prompt: `Title: ${input.title ?? "(no title)"}\n\nAbstract:\n${input.abstract}`,
  });
  const summary: PaperSummary = {
    researchQuestion: out.research_question.trim(),
    methodology: out.methodology.trim(),
    mainFinding: out.main_finding.trim(),
    limitations: out.limitations.trim(),
  };
  cache.set(key, summary);
  return { summary, model };
}
