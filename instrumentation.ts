export async function register() {
  // Warm the multilingual embedding model in the background so the first search is fast.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadEmbeddings } = await import("./lib/embeddings");
    void loadEmbeddings();
  }
}
