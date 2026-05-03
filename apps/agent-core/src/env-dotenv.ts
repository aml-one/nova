/**
 * Load `.env` from the monorepo root when agent-core runs with cwd `apps/agent-core`
 * (e.g. `pnpm --filter @nova/agent-core dev`). Default `dotenv/config` only reads `process.cwd()/.env`.
 */
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let d = dirname(fileURLToPath(import.meta.url));
let loaded = false;
for (let i = 0; i < 12; i++) {
  const ws = resolve(d, "pnpm-workspace.yaml");
  const envFile = resolve(d, ".env");
  if (existsSync(ws) && existsSync(envFile)) {
    dotenv.config({ path: envFile });
    loaded = true;
    break;
  }
  const parent = resolve(d, "..");
  if (parent === d) break;
  d = parent;
}
if (!loaded) {
  const cwdEnv = resolve(process.cwd(), ".env");
  if (existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
  } else {
    dotenv.config();
  }
}
