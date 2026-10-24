// Sanity check: does the multilingual model place cross-language paraphrases close together?
import { pipeline, env } from "@huggingface/transformers";
env.cacheDir = ".cache/models";
const model = process.env.EMBEDDING_MODEL ?? "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
const query = "How does drought stress affect rice crop yields?";
const candidates = [
  "Effects of drought stress on rice grain yield",
  "干旱胁迫对水稻产量的影响",
  "Efectos del estrés hídrico en el rendimiento del arroz",
  "干ばつストレスがイネの収量に与える影響",
  "Efeitos do estresse hídrico na produtividade do arroz",
  "Deep learning for melanoma detection in dermoscopic images",
  "城市空气污染与儿童哮喘",
];
const t0 = Date.now();
const out = await extractor([query, ...candidates], { pooling: "mean", normalize: true });
const v = out.tolist();
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
for (let i = 0; i < candidates.length; i++) console.log(cos(v[0], v[i + 1]).toFixed(3), candidates[i]);
console.log(`dims=${v[0].length} ms=${Date.now() - t0}`);
