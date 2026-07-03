import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingExcludes: {
    "/*": [
      "storage/**/*",
      "artifacts/**/*",
      "docs/**/*",
      "scripts/**/*",
      "src/**/*.test.*",
      "next.config.*",
      "vitest.config.*",
      "eslint.config.*",
      "prisma.config.*",
      "tsconfig.tsbuildinfo",
      "dev.db",
      "ready-to-post-implemented-desktop.png",
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2gb",
    },
  },
};

export default nextConfig;
