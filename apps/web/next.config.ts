import path from "node:path";
import type { NextConfig } from "next";

/** Monorepo root (pnpm-lock.yaml). Assumes `next build` runs with cwd `apps/web` (default for this package). */
const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  /** Inlined at build so Edge Middleware can read homelab overrides (see auth-login-policy). */
  env: {
    NOVA_WEB_LOGIN_ENABLED: process.env.NOVA_WEB_LOGIN_ENABLED ?? ""
  }
};

export default nextConfig;
