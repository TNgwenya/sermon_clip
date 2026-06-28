import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async rewrites() {
    return [
      {
        source: "/tiktokfLd97ImnjWIJmcyM6oqmjHob9AvuOAex.txt/:path*",
        destination: "/tiktokfLd97ImnjWIJmcyM6oqmjHob9AvuOAex.txt",
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2gb",
    },
  },
};

export default nextConfig;
