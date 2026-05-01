import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve as resolvePath } from "node:path";
import type { AppSettings } from "../storage/repositories/settings-repository.js";

export const DEFAULT_GITHUB_COPILOT_BASE_URL = "https://api.githubcopilot.com";

type CopilotAuthFile = {
  copilotToken?: string;
  githubAccessToken?: string;
};

let copilotSettingsGetter: (() => AppSettings) | undefined;

/** Must be registered from bootstrap so Copilot can read SQLite-backed settings + device-login profile. */
export function registerCopilotSettingsSource(getter: () => AppSettings): void {
  copilotSettingsGetter = getter;
}

export function copilotAuthFilePath(): string {
  const dir = process.env.NOVA_COPILOT_AUTH_DIR?.trim() || resolvePath(homedir(), ".nova");
  return resolvePath(dir, "copilot-auth.json");
}

export function readCopilotAuthProfile(): CopilotAuthFile | null {
  const path = copilotAuthFilePath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CopilotAuthFile;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchCopilotTokenFromGithub(githubAccessToken: string): Promise<string | undefined> {
  try {
    const copilotResponse = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: {
        authorization: `Bearer ${githubAccessToken}`,
        accept: "application/json"
      }
    });
    if (!copilotResponse.ok) return undefined;
    const body = (await copilotResponse.json()) as { token?: string };
    return typeof body?.token === "string" ? body.token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve Copilot HTTP credentials for OpenAI-compatible calls (/models, /chat/completions).
 * Order: env pair → settings api key + base URL → ~/.nova/copilot-auth.json (copilot token or GitHub→Copilot exchange).
 */
export async function resolveCopilotRuntime(): Promise<{ baseUrl: string; apiKey: string }> {
  const envBase = process.env.COPILOT_BASE_URL?.trim() ?? "";
  const envKey = process.env.COPILOT_API_KEY?.trim() ?? "";
  if (envBase && envKey) {
    return { baseUrl: envBase, apiKey: envKey };
  }

  const settings = copilotSettingsGetter?.();
  let baseUrl = settings?.copilot.baseUrl?.trim() || envBase || "";
  let apiKey = settings?.copilot.apiKey?.trim() || envKey || "";

  const auth = readCopilotAuthProfile();
  if (!apiKey && auth?.copilotToken?.trim()) {
    apiKey = auth.copilotToken.trim();
  }
  if (!apiKey && auth?.githubAccessToken?.trim()) {
    const exchanged = await fetchCopilotTokenFromGithub(auth.githubAccessToken.trim());
    if (exchanged) apiKey = exchanged;
  }

  if (!baseUrl && apiKey) {
    baseUrl = DEFAULT_GITHUB_COPILOT_BASE_URL;
  }

  return { baseUrl, apiKey };
}

/** Sync hints for setup UI (optional GitHub token refresh not attempted). */
export function copilotLikelyConfigured(getSettings: () => AppSettings): boolean {
  const envOk = Boolean(process.env.COPILOT_BASE_URL?.trim() && process.env.COPILOT_API_KEY?.trim());
  if (envOk) return true;
  const s = getSettings();
  if (s.copilot.baseUrl?.trim() && s.copilot.apiKey?.trim()) return true;
  const auth = readCopilotAuthProfile();
  if (auth?.copilotToken?.trim()) return true;
  if (auth?.githubAccessToken?.trim()) return true;
  return false;
}

export function resolveCopilotDefaultModelId(): string {
  const envModel = process.env.COPILOT_MODEL?.trim();
  if (envModel) return envModel;
  try {
    const s = copilotSettingsGetter?.();
    const fromCopilot = s?.copilot.defaultModel?.trim();
    if (fromCopilot) return fromCopilot;
    const fromDefaults = s?.models.defaultByProvider.copilot?.trim();
    if (fromDefaults) return fromDefaults;
  } catch {
    // ignore
  }
  return "gpt-4o-mini";
}
