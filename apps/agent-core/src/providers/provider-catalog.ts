import type { AppSettings } from "../storage/repositories/settings-repository.js";
import {
  copilotLikelyConfigured,
  headersForCopilotModelsGet,
  isCopilotIntegrationDisabled,
  resolveCopilotRuntime
} from "./copilot-credentials.js";
import { isLmStudioIntegrationDisabled, isOllamaIntegrationDisabled } from "./provider-integration.js";

type ProviderName = "ollama" | "lmstudio" | "copilot";

export type ProviderModelInfo = {
  id: string;
  provider: ProviderName;
};

function dedupeProviderModelsById(models: ProviderModelInfo[]): ProviderModelInfo[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    const id = m.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export class ProviderCatalogService {
  constructor(private readonly getSettings: () => AppSettings) {}

  async listModels(): Promise<Record<ProviderName, ProviderModelInfo[]>> {
    const [ollama, lmstudio, copilot] = await Promise.all([
      isOllamaIntegrationDisabled() ? Promise.resolve([]) : this.listOllamaModels(),
      isLmStudioIntegrationDisabled() ? Promise.resolve([]) : this.listLmstudioModels(),
      this.listCopilotModels()
    ]);
    return { ollama, lmstudio, copilot };
  }

  buildProviderSetupStatus(): Record<
    ProviderName | "signalBridge" | "whatsAppBridge",
    { configured: boolean; steps: string[]; details: string }
  > {
    const s = this.getSettings();
    const ollamaDisabled = s.ollama.disabled !== false;
    const lmstudioDisabled = s.lmstudio.disabled !== false;
    const copilotDisabled = s.copilot.disabled === true;
    const copilotConfigured = !copilotDisabled && copilotLikelyConfigured(this.getSettings);
    const waConfigured = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN);
    const signalConfigured = Boolean(process.env.SIGNAL_API_URL && process.env.SIGNAL_ACCOUNT_NUMBER);
    return {
      ollama: {
        configured: ollamaDisabled || Boolean(process.env.OLLAMA_BASE_URL),
        details: ollamaDisabled
          ? "Ollama is disabled (Models → Ollama default model → Disabled)."
          : process.env.OLLAMA_BASE_URL
            ? "Endpoint configured"
            : "Set OLLAMA_BASE_URL and OLLAMA_MODEL",
        steps: ollamaDisabled
          ? ["Choose Auto / env default or a model to enable Ollama."]
          : [
              "Install Ollama and pull a model",
              "Set OLLAMA_BASE_URL",
              "Choose default model in Settings > Models"
            ]
      },
      lmstudio: {
        configured: lmstudioDisabled || Boolean(process.env.LMSTUDIO_BASE_URL),
        details: lmstudioDisabled
          ? "LM Studio is disabled (Models → LM Studio default model → Disabled)."
          : process.env.LMSTUDIO_BASE_URL
            ? "Endpoint configured"
            : "Set LMSTUDIO_BASE_URL and LMSTUDIO_MODEL",
        steps: lmstudioDisabled
          ? ["Choose Auto / env default or a model to enable LM Studio."]
          : [
              "Start LM Studio local server",
              "Set LMSTUDIO_BASE_URL",
              "Choose default model in Settings > Models"
            ]
      },
      copilot: {
        configured: copilotConfigured,
        details: copilotDisabled
          ? "Copilot is disabled (Models → Copilot default model → Disabled)."
          : copilotConfigured
            ? "Copilot credentials available (env, Settings, or device-login profile)"
            : "Set Copilot URL + API key in Settings, env vars, or complete GitHub device login.",
        steps: copilotDisabled
          ? ["Choose Auto / env default or a specific Copilot model to turn integration back on."]
          : [
              "Pick a preset (GitHub Models, OpenRouter, GitHub device login, or custom URL).",
              "Use API key paste or device login so Nova can call /models.",
              "Choose default Copilot model in Settings > Models."
            ]
      },
      signalBridge: {
        configured: signalConfigured,
        details: signalConfigured ? "Signal bridge configured" : "Set SIGNAL_API_URL and SIGNAL_ACCOUNT_NUMBER",
        steps: [
          "Run signal-cli-rest-api (Docker or local service).",
          "Link your Signal number once in signal-cli-rest-api.",
          "Set SIGNAL_API_URL and SIGNAL_ACCOUNT_NUMBER (+ optional SIGNAL_WEBHOOK_SECRET)."
        ]
      },
      whatsAppBridge: {
        configured: waConfigured,
        details: waConfigured ? "WhatsApp bridge configured" : "Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN",
        steps: [
          "In Meta for Developers, create an app and add WhatsApp product.",
          "Copy Phone Number ID and generate a permanent access token.",
          "Set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TOKEN, and optional WHATSAPP_APP_SECRET."
        ]
      }
    };
  }

  private async listOllamaModels(): Promise<ProviderModelInfo[]> {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: Array<{ name?: string }> };
      return (data.models ?? [])
        .map((item) => item.name?.trim())
        .filter((item): item is string => Boolean(item))
        .map((id) => ({ id, provider: "ollama" as const }));
    } catch {
      return [];
    }
  }

  private async listLmstudioModels(): Promise<ProviderModelInfo[]> {
    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1";
    try {
      const response = await fetch(`${baseUrl}/models`);
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: Array<{ id?: string }> };
      return (data.data ?? [])
        .map((item) => item.id?.trim())
        .filter((item): item is string => Boolean(item))
        .map((id) => ({ id, provider: "lmstudio" as const }));
    } catch {
      return [];
    }
  }

  private async listCopilotModels(): Promise<ProviderModelInfo[]> {
    if (isCopilotIntegrationDisabled()) return [];
    const { baseUrl, apiKey } = await resolveCopilotRuntime();
    if (!baseUrl || !apiKey) return [];
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
        headers: headersForCopilotModelsGet(baseUrl, apiKey)
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: Array<{ id?: string }> };
      const raw = (data.data ?? [])
        .map((item) => item.id?.trim())
        .filter((item): item is string => Boolean(item))
        .map((id) => ({ id, provider: "copilot" as const }));
      return dedupeProviderModelsById(raw);
    } catch {
      return [];
    }
  }
}
