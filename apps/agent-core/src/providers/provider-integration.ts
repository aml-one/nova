import type { AppSettings } from "../storage/repositories/settings-repository.js";

let getAppSettings: (() => AppSettings) | undefined;

/** Shared accessor for provider enable/disable flags (register from bootstrap). */
export function registerAppSettingsForProviderToggles(getter: () => AppSettings): void {
  getAppSettings = getter;
}

export function isOllamaIntegrationDisabled(): boolean {
  const raw = process.env.NOVA_OLLAMA_DISABLED?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  try {
    return getAppSettings?.().ollama.disabled !== false;
  } catch {
    return true;
  }
}

export function isLmStudioIntegrationDisabled(): boolean {
  const raw = process.env.NOVA_LMSTUDIO_DISABLED?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  try {
    return getAppSettings?.().lmstudio.disabled !== false;
  } catch {
    return true;
  }
}

export function isCopilotIntegrationDisabled(): boolean {
  if (process.env.NOVA_COPILOT_DISABLED === "true") return true;
  try {
    return getAppSettings?.().copilot.disabled === true;
  } catch {
    return false;
  }
}

