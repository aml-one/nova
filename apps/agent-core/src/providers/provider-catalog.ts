type ProviderName = "ollama" | "lmstudio" | "copilot";

export type ProviderModelInfo = {
  id: string;
  provider: ProviderName;
};

export class ProviderCatalogService {
  async listModels(): Promise<Record<ProviderName, ProviderModelInfo[]>> {
    const [ollama, lmstudio, copilot] = await Promise.all([
      this.listOllamaModels(),
      this.listLmstudioModels(),
      this.listCopilotModels()
    ]);
    return { ollama, lmstudio, copilot };
  }

  buildProviderSetupStatus(): Record<
    ProviderName | "signalBridge" | "whatsAppBridge",
    { configured: boolean; steps: string[]; details: string }
  > {
    const copilotConfigured = Boolean(process.env.COPILOT_BASE_URL && process.env.COPILOT_API_KEY);
    const waConfigured = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN);
    const signalConfigured = Boolean(process.env.SIGNAL_API_URL && process.env.SIGNAL_ACCOUNT_NUMBER);
    return {
      ollama: {
        configured: Boolean(process.env.OLLAMA_BASE_URL),
        details: process.env.OLLAMA_BASE_URL ? "Endpoint configured" : "Set OLLAMA_BASE_URL and OLLAMA_MODEL",
        steps: [
          "Install Ollama and pull a model",
          "Set OLLAMA_BASE_URL",
          "Choose default model in Settings > Models"
        ]
      },
      lmstudio: {
        configured: Boolean(process.env.LMSTUDIO_BASE_URL),
        details: process.env.LMSTUDIO_BASE_URL ? "Endpoint configured" : "Set LMSTUDIO_BASE_URL and LMSTUDIO_MODEL",
        steps: [
          "Start LM Studio local server",
          "Set LMSTUDIO_BASE_URL",
          "Choose default model in Settings > Models"
        ]
      },
      copilot: {
        configured: copilotConfigured,
        details: copilotConfigured ? "Endpoint and API key configured" : "Set COPILOT_BASE_URL and COPILOT_API_KEY",
        steps: [
          "Create/authenticate Copilot-compatible API key",
          "Set COPILOT_BASE_URL",
          "Set COPILOT_API_KEY and default model"
        ]
      },
      signalBridge: {
        configured: signalConfigured,
        details: signalConfigured ? "Signal bridge configured" : "Set SIGNAL_API_URL and SIGNAL_ACCOUNT_NUMBER",
        steps: [
          "Run signal-cli-rest-api bridge",
          "Set SIGNAL_API_URL",
          "Set SIGNAL_ACCOUNT_NUMBER and optional SIGNAL_WEBHOOK_SECRET"
        ]
      },
      whatsAppBridge: {
        configured: waConfigured,
        details: waConfigured ? "WhatsApp bridge configured" : "Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN",
        steps: [
          "Configure WhatsApp Cloud App credentials",
          "Set WHATSAPP_PHONE_NUMBER_ID",
          "Set WHATSAPP_TOKEN and optional WHATSAPP_APP_SECRET"
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
    const baseUrl = process.env.COPILOT_BASE_URL;
    const apiKey = process.env.COPILOT_API_KEY;
    if (!baseUrl || !apiKey) return [];
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { authorization: `Bearer ${apiKey}` }
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: Array<{ id?: string }> };
      return (data.data ?? [])
        .map((item) => item.id?.trim())
        .filter((item): item is string => Boolean(item))
        .map((id) => ({ id, provider: "copilot" as const }));
    } catch {
      return [];
    }
  }
}
