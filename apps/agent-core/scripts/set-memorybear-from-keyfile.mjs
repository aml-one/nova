/**
 * One-shot: read ~/nova-deps/memorybear-nova-api-key.txt and persist MemoryBear
 * settings in Nova SQLite (same encryption path as the UI).
 * Usage (from apps/agent-core): pnpm exec tsx scripts/set-memorybear-from-keyfile.mjs
 */
import "../src/env-dotenv.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { SettingsService } from "../src/settings/settings-service.js";

const path = `${homedir()}/nova-deps/memorybear-nova-api-key.txt`;
const key = readFileSync(path, "utf8").trim();
if (!key) {
  console.error(`Empty or missing key: ${path}`);
  process.exit(1);
}
const s = new SettingsService();
s.updatePartial({
  memoryBear: {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    apiKey: key,
    syncWrites: true
  }
});
console.log(`MemoryBear settings saved (key length ${key.length}).`);
