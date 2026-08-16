import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  transpilePackages: [
    "@cardforge/card-schema",
    "@cardforge/rules-kernel",
    "@cardforge/rules-tempofront",
  ],
};

export default nextConfig;
