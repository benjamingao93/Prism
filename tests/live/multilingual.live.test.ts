// One-off live verification (not part of the suite): real OpenAlex + real embeddings,
// with hand-written query variants standing in for the LLM.
import { it } from "vitest";
import { searchOpenAlex } from "@/lib/openalex";
import { runSearch } from "@/lib/search";
import { semanticScores } from "@/lib/embeddings";
import { SearchRequestSchema } from "@/lib/types";
import { compareBaseline, computeCoverage } from "@/lib/comparison";
import { writeFileSync } from "node:fs";

it("live multilingual search", async () => {
  process.env.EMBEDDING_CACHE_DIR = ".cache/models";
  const res = await runSearch(SearchRequestSchema.parse({ query: "How does drought stress affect rice crop yields?", limit: 25 }), {
    expand: async () => ({ model: "manual", notice: null, variants: [
      { lang: "en", kind: "original", text: "How does drought stress affect rice crop yields?", concepts: ["drought", "stress", "rice", "yield"], topic: "drought" },
      { lang: "zh", kind: "translated", text: "干旱胁迫如何影响水稻产量？", concepts: ["干旱胁迫", "水稻", "产量"], topic: "干旱胁迫" },
      { lang: "es", kind: "translated", text: "¿Cómo afecta el estrés por sequía al rendimiento del arroz?", concepts: ["sequía", "arroz", "rendimiento"], topic: "sequía" },
      { lang: "ja", kind: "translated", text: "干ばつストレスはイネの収量にどのように影響するか？", concepts: ["干ばつ", "イネ", "収量"], topic: "干ばつ" },
      { lang: "pt", kind: "translated", text: "Como o estresse hídrico afeta a produtividade do arroz?", concepts: ["seca", "arroz", "produtividade"], topic: "seca" },
    ]}),
    searchOpenAlex: (p) => searchOpenAlex(p, { apiKey: null, mailto: null }),
    countByLanguage: null,
    checkLanguages: null,
    sourceCountries: null,
    searchCrossref: null,
    semantic: (texts, papers, field) => semanticScores(texts, papers, { field, waitMs: 120000 }),
    capabilities: () => ({ llm: false, embeddings: "ready", embeddingModel: "x", openalexKey: false, crossref: false }),
  });
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(res));
  const cov = computeCoverage(res.papers, res.variants);
  const cmp = compareBaseline(res.papers, res.variants, "hybrid", 10);
  console.log("variants", res.variants.map((v) => `${v.lang}:${v.hitCount}${v.relaxed ? "(relaxed)" : ""}${v.error ? " ERR " + v.error : ""}`).join(" "));
  console.log("coverage", JSON.stringify(cov));
  console.log("overlap", cmp.overlap, "additional", cmp.additional.length);
  for (const p of res.papers.slice(0, 15)) console.log(p.scores.semanticRaw?.toFixed(3), p.scores.keyword.toFixed(2), p.scores.hybrid?.toFixed(3), p.language, (p.title ?? "").slice(0, 60));
}, 180000);
