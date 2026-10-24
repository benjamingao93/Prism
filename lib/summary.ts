import "server-only";
import { z } from "zod";
import { globalCache } from "./cache";
import { env, modelChain } from "./env";
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

const cache = globalCache<{ summary: PaperSummary; model: string }>("summaries", 1000, 7 * 24 * 60 * 60 * 1000);

export async function summarizeAbstract(input: {
  id: string;
  title: string | null;
  abstract: string;
  targetLang: QueryLanguage;
}): Promise<{ summary: PaperSummary; model: string }> {
  const key = `${input.targetLang}|${input.id}|${input.abstract.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const notStated = input.targetLang === "en" ? NOT_STATED : `"${NOT_STATED}" translated into ${languageName(input.targetLang)}`;
  const { data: out, model } = await structuredCall(SummarySchema, {
    models: modelChain(env().LLM_MODEL_SUMMARY),
    maxTokens: 4000,
    thinking: "low",
    timeoutMs: 30_000,
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
  cache.set(key, { summary, model });
  return { summary, model };
}
