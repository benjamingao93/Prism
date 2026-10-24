// Opt-in live check (`npm run test:live`): hits the real OpenAlex API and runs the local embedding model.
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": root,
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: { include: ["tests/live/**/*.live.test.ts"], environment: "node", testTimeout: 180_000 },
});
