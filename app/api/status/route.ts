import { connection } from "next/server";
import { loadEmbeddings } from "@/lib/embeddings";
import { capabilities } from "@/lib/server";

export async function GET() {
  // Read live process state at request time rather than prerendering at build.
  await connection();
  void loadEmbeddings();
  return Response.json(capabilities(), { headers: { "Cache-Control": "no-store" } });
}
