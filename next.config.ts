import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Snapshot artifacts are read from disk at runtime by route handlers and RSC
  // pages; file tracing must bundle them with every route on Vercel.
  outputFileTracingIncludes: {
    "/**": ["./data/artifacts/**"],
  },
};

export default nextConfig;
