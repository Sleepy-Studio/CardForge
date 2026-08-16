import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@cardforge/card-schema",
    "@cardforge/rules-kernel",
    "@cardforge/rules-tempofront",
  ],
};

export default nextConfig;
