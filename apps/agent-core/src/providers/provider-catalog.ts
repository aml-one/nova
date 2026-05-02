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

export type ProviderCatalogModels = {
  ollama: ProviderModelInfo[];
  lmstudio: ProviderModelInfo[];
  copilot: ProviderModelInfo[];
  /** Ollama models that report `vision` in /api/tags or /api/show (best-effort). */
  ollamaVision: ProviderModelInfo[];
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

  async listModels(): Promise<ProviderCatalogModels> {
    const [ollama, lmstudio, copilot, ollamaVision] = await Promise.all([
      isOllamaIntegrationDisabled() ? Promise.resolve([]) : this.listOllamaModels(),
      isLmStudioIntegrationDisabled() ? Promise.resolve([]) : this.listLmstudioModels(),
      this.listCopilotModels(),
      isOllamaIntegrationDisabled() ? Promise.resolve([]) : this.listOllamaVisionModels()
    ]);
    return { ollama, lmstudio, copilot, ollamaVision };
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

  /** Uses /api/tags `capabilities` when present, otherwise probes /api/show in small batches. */
  private async listOllamaVisionModels(): Promise<ProviderModelInfo[]> {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    type TagModel = { name?: string; capabilities?: string[] };
    let tagModels: TagModel[] = [];
    try {
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: TagModel[] };
      tagModels = data.models ?? [];
    } catch {
      return [];
    }
    const visionIds: string[] = [];
    const probeNames: string[] = [];
    for (const item of tagModels) {
      const name = item.name?.trim();
      if (!name) continue;
      if (Array.isArray(item.capabilities) && item.capabilities.includes("vision")) {
        visionIds.push(name);
      } else if (!Array.isArray(item.capabilities) || item.capabilities.length === 0) {
        probeNames.push(name);
      }
    }
    const batchSize = 4;
    for (let i = 0; i < probeNames.length; i += batchSize) {
      const slice = probeNames.slice(i, i + batchSize);
      const found = await Promise.all(
        slice.map(async (model) => {
          try {
            const r = await fetch(`${baseUrl}/api/show`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ model })
            });
            if (!r.ok) return null;
            const payload = (await r.json()) as { capabilities?: string[] };
            return Array.isArray(payload.capabilities) && payload.capabilities.includes("vision") ? model : null;
          } catch {
            return null;
          }
        })
      );
      for (const id of found) {
        if (id) visionIds.push(id);
      }
    }
    return dedupeProviderModelsById(visionIds.map((id) => ({ id, provider: "ollama" as const })));
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
