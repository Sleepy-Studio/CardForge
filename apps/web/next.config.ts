import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  // Self-contained server bundle for the production container image.
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  // Next's tracer follows @swc/helpers' CommonJS entry but the server loads
  // its ESM helpers at runtime; include them so the standalone bundle boots.
  outputFileTracingIncludes: {
    "*": ["../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/esm/**"],
  },
  poweredByHeader: false,
  transpilePackages: [
    "@cardforge/card-schema",
    "@cardforge/economy",
    "@cardforge/rules-kernel",
    "@cardforge/rules-tempofront",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "x-content-type-options", value: "nosniff" },
          { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
          { key: "x-frame-options", value: "DENY" },
          { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
