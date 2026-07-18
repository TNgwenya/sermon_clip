import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // EC2's free-tier instance cannot reliably repeat the full TypeScript check
  // during a production build. The deployment command enables this only after
  // the same check has passed locally/CI.
  typescript: {
    ignoreBuildErrors: process.env.SKIP_DEPLOY_TYPECHECK === "true",
  },
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
      bodySizeLimit: "3gb",
    },
  },
};

export default nextConfig;
