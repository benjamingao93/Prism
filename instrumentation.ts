export async function register() {
  // Warm the multilingual embedding model in the background so the first search is fast.
  // Not on Vercel: every function instance would download the model, and most never use it.
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const { loadEmbeddings } = await import("./lib/embeddings");
    void loadEmbeddings();
  }
}
