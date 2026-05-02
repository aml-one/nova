import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve as resolvePath } from "node:path";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { registerAppSettingsForProviderToggles, isCopilotIntegrationDisabled } from "./provider-integration.js";

export { isCopilotIntegrationDisabled };

export const DEFAULT_GITHUB_COPILOT_BASE_URL = "https://api.githubcopilot.com";

/** Required on api.githubcopilot.com requests or GitHub returns 4xx (documented in Copilot reverse‑engineering guides). */
export const GITHUB_COPILOT_VSCODE_CHAT_INTEGRATION_ID = "vscode-chat";

export function isGithubCopilotApiBase(baseUrl: string): boolean {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  try {
    const withProto = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(withProto).hostname.toLowerCase() === "api.githubcopilot.com";
  } catch {
    return trimmed.toLowerCase().includes("api.githubcopilot.com");
  }
}

/** GET /models + chat/completions against GitHub Copilot need this integration header. */
export function githubCopilotApiExtraHeaders(baseUrl: string): Record<string, string> | undefined {
  if (!isGithubCopilotApiBase(baseUrl)) return undefined;
  return { "Copilot-Integration-Id": GITHUB_COPILOT_VSCODE_CHAT_INTEGRATION_ID };
}

export function headersForCopilotModelsGet(baseUrl: string, apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json"
  };
  const extra = githubCopilotApiExtraHeaders(baseUrl);
  if (extra) Object.assign(headers, extra);
  return headers;
}

type CopilotAuthFile = {
  copilotToken?: string;
  githubAccessToken?: string;
};

let copilotSettingsGetter: (() => AppSettings) | undefined;

/** Must be registered from bootstrap so Copilot can read SQLite-backed settings + device-login profile. */
export function registerCopilotSettingsSource(getter: () => AppSettings): void {
  copilotSettingsGetter = getter;
  registerAppSettingsForProviderToggles(getter);
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
 *
 * - Full `COPILOT_BASE_URL` + `COPILOT_API_KEY` in env wins.
 * - For **api.githubcopilot.com**, prefer refreshing a short-lived Copilot token from the device-login
 *   GitHub OAuth token, then the file `copilotToken`, then Settings API key (stale keys caused 401s).
 * - For other bases (OpenRouter, Azure GitHub Models, local), prefer Settings / env API key, then auth file.
 */
export async function resolveCopilotRuntime(): Promise<{ baseUrl: string; apiKey: string }> {
  if (isCopilotIntegrationDisabled()) {
    return { baseUrl: "", apiKey: "" };
  }
  const envBase = process.env.COPILOT_BASE_URL?.trim() ?? "";
  const envKey = process.env.COPILOT_API_KEY?.trim() ?? "";
  if (envBase && envKey) {
    return { baseUrl: envBase, apiKey: envKey };
  }

  const settings = copilotSettingsGetter?.();
  let baseUrl = settings?.copilot.baseUrl?.trim() || envBase || "";
  const auth = readCopilotAuthProfile();
  const deviceAuthAvailable = Boolean(auth?.githubAccessToken?.trim() || auth?.copilotToken?.trim());

  if (!baseUrl && deviceAuthAvailable) {
    baseUrl = DEFAULT_GITHUB_COPILOT_BASE_URL;
  }

  if (isGithubCopilotApiBase(baseUrl)) {
    let apiKey = "";
    if (auth?.githubAccessToken?.trim()) {
      const fresh = await fetchCopilotTokenFromGithub(auth.githubAccessToken.trim());
      if (fresh) apiKey = fresh;
    }
    if (!apiKey && auth?.copilotToken?.trim()) {
      apiKey = auth.copilotToken.trim();
    }
    if (!apiKey) {
      apiKey = settings?.copilot.apiKey?.trim() || envKey || "";
    }
    return { baseUrl: DEFAULT_GITHUB_COPILOT_BASE_URL, apiKey };
  }

  let apiKey = settings?.copilot.apiKey?.trim() || envKey || "";
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
  if (process.env.NOVA_COPILOT_DISABLED === "true") return false;
  if (getSettings().copilot.disabled === true) return false;
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
  if (isCopilotIntegrationDisabled()) return "";
  const envModel = process.env.COPILOT_MODEL?.trim();
  if (envModel) return envModel;
  try {
    const s = copilotSettingsGetter?.();
    const fromDropdown = s?.models.defaultByProvider.copilot?.trim();
    if (fromDropdown) return fromDropdown;
    const fromCopilotSection = s?.copilot.defaultModel?.trim();
    if (fromCopilotSection) return fromCopilotSection;
  } catch {
    // ignore
  }
  /** Smaller / “mini” class models are typically the lightest Copilot tier; still subject to your GitHub Copilot subscription. */
  return "gpt-4o-mini";
}
