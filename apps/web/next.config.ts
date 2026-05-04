import path from "node:path";
import type { NextConfig } from "next";

/** Monorepo root (pnpm-lock.yaml). Assumes `next build` runs with cwd `apps/web` (default for this package). */
const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot
};

export default nextConfig;
