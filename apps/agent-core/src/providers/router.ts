import type { ChatMessage, ChatRequest, ModelResponse } from "@nova/sdk/provider";
import { CopilotProvider } from "./copilot.js";
import { LMStudioProvider } from "./lmstudio.js";
import { OllamaProvider } from "./ollama.js";

type ProviderState = {
  weight: number;
  failures: number;
  openUntil: number;
  healthy: boolean;
  baseBackoffMs: number;
  maxBackoffMs: number;
};

export class ModelRouter {
  private readonly providers = [new OllamaProvider(), new LMStudioProvider(), new CopilotProvider()];
  private activeProvider = process.env.NOVA_PROVIDER ?? "ollama";
  private readonly state = new Map<string, ProviderState>();
  private lastHealthCheckAt = 0;

  constructor() {
    this.state.set("ollama", {
      weight: Number(process.env.NOVA_WEIGHT_OLLAMA ?? 5),
      failures: 0,
      openUntil: 0,
      healthy: true,
      baseBackoffMs: Number(process.env.NOVA_BACKOFF_OLLAMA_BASE_MS ?? 4000),
      maxBackoffMs: Number(process.env.NOVA_BACKOFF_OLLAMA_MAX_MS ?? 60000)
    });
    this.state.set("lmstudio", {
      weight: Number(process.env.NOVA_WEIGHT_LMSTUDIO ?? 3),
      failures: 0,
      openUntil: 0,
      healthy: true,
      baseBackoffMs: Number(process.env.NOVA_BACKOFF_LMSTUDIO_BASE_MS ?? 3000),
      maxBackoffMs: Number(process.env.NOVA_BACKOFF_LMSTUDIO_MAX_MS ?? 45000)
    });
    this.state.set("copilot", {
      weight: Number(process.env.NOVA_WEIGHT_COPILOT ?? 2),
      failures: 0,
      openUntil: 0,
      healthy: true,
      baseBackoffMs: Number(process.env.NOVA_BACKOFF_COPILOT_BASE_MS ?? 5000),
      maxBackoffMs: Number(process.env.NOVA_BACKOFF_COPILOT_MAX_MS ?? 90000)
    });
  }

  setActiveProvider(name: "ollama" | "lmstudio" | "copilot"): void {
    this.activeProvider = name;
  }

  getActiveProvider(): "ollama" | "lmstudio" | "copilot" {
    return this.activeProvider === "lmstudio" || this.activeProvider === "copilot" ? this.activeProvider : "ollama";
  }

  async health(): Promise<Record<string, boolean>> {
    const checks = await Promise.all(this.providers.map(async (provider) => provider.health()));
    for (const check of checks) {
      const state = this.state.get(check.name);
      if (state) {
        state.healthy = check.ok;
      }
    }
    return Object.fromEntries(checks.map((check) => [check.name, check.ok]));
  }

  async chat(messages: ChatMessage[], model?: string): Promise<ModelResponse> {
    await this.maybeRefreshHealth();
    const ordered = this.selectProviders();

    let lastError: Error | undefined;
    for (const provider of ordered) {
      const providerState = this.state.get(provider.name);
      if (!providerState) {
        continue;
      }
      if (providerState.openUntil > Date.now()) {
        continue;
      }
      try {
        const request: ChatRequest = { messages, model };
        const response = await provider.chat(request);
        providerState.failures = 0;
        providerState.openUntil = 0;
        return response;
      } catch (error) {
        providerState.failures += 1;
        const backoff = Math.min(
          providerState.maxBackoffMs,
          providerState.baseBackoffMs * Math.pow(2, Math.max(0, providerState.failures - 1))
        );
        providerState.openUntil = Date.now() + backoff;
        lastError = error instanceof Error ? error : new Error("provider request failed");
      }
    }
    throw lastError ?? new Error("no model providers are available");
  }

  async chatStream(messages: ChatMessage[], onToken: (token: string) => void, model?: string): Promise<ModelResponse> {
    await this.maybeRefreshHealth();
    const ordered = this.selectProviders();
    let lastError: Error | undefined;
    for (const provider of ordered) {
      const providerState = this.state.get(provider.name);
      if (!providerState || providerState.openUntil > Date.now()) {
        continue;
      }
      try {
        const response = await provider.streamChat({ messages, model }, onToken);
        providerState.failures = 0;
        providerState.openUntil = 0;
        return response;
      } catch (error) {
        providerState.failures += 1;
        const backoff = Math.min(
          providerState.maxBackoffMs,
          providerState.baseBackoffMs * Math.pow(2, Math.max(0, providerState.failures - 1))
        );
        providerState.openUntil = Date.now() + backoff;
        lastError = error instanceof Error ? error : new Error("provider stream failed");
      }
    }
    throw lastError ?? new Error("no model providers are available for streaming");
  }

  private async maybeRefreshHealth(): Promise<void> {
    const everyMs = 20_000;
    if (Date.now() - this.lastHealthCheckAt < everyMs) {
      return;
    }
    this.lastHealthCheckAt = Date.now();
    await this.health();
  }

  private selectProviders(): typeof this.providers {
    const activeFirst = [...this.providers].sort((a, b) => {
      if (a.name === this.activeProvider) {
        return -1;
      }
      if (b.name === this.activeProvider) {
        return 1;
      }
      return 0;
    });
    return activeFirst.sort((a, b) => {
      const sa = this.state.get(a.name);
      const sb = this.state.get(b.name);
      const wa = sa?.healthy ? sa.weight : 0;
      const wb = sb?.healthy ? sb.weight : 0;
      return wb - wa;
    });
  }
}
