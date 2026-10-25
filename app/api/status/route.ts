import { connection } from "next/server";
import { embeddingsOnDemand, loadEmbeddings } from "@/lib/embeddings";
import { capabilities } from "@/lib/server";

export async function GET() {
  // Read live process state at request time rather than prerendering at build.
  await connection();
  // Serverless freezes background work after the response, and this instance never ranks
  // anything, so on Vercel the search request loads the model itself.
  if (!embeddingsOnDemand) void loadEmbeddings();
  return Response.json(capabilities(), { headers: { "Cache-Control": "no-store" } });
}
