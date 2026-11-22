import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here shows live, per-user data, so Cache Components (which
  // requires Suspense around all dynamic data) is intentionally left off.
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
