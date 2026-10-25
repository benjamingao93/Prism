import type { NextConfig } from "next";

const ONNX_RUNTIME = [
  "./node_modules/onnxruntime-node/package.json",
  "./node_modules/onnxruntime-node/dist/**/*",
  "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
  "./node_modules/onnxruntime-node/node_modules/**/*",
  "./node_modules/onnxruntime-common/**/*",
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Keep server functions under Vercel's 250 MB limit: it runs linux/x64, so the other platforms'
  // ONNX Runtime binaries (~240 MB) aren't needed, and the local model cache is never deployed.
  // Transformers.js loads ONNX Runtime through createRequire, which the tracer can't follow, so the
  // routes that embed text include its JS and linux/x64 binary explicitly.
  outputFileTracingIncludes: {
    "/api/search": ONNX_RUNTIME,
    "/api/gaps": ONNX_RUNTIME,
  },
  outputFileTracingExcludes: {
    "/*": [
      "./node_modules/onnxruntime-node/bin/napi-v6/darwin/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/win32/**/*",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**/*",
      "./.cache/**/*",
    ],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
