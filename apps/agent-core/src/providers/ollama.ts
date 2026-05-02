import type { ChatRequest, ModelProvider, ModelResponse, ProviderHealth } from "@nova/sdk/provider";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { registerAppSettingsForProviderToggles } from "./provider-integration.js";

let appSettingsGetter: (() => AppSettings) | undefined;

/** Call from bootstrap so Ollama can read `models.ollamaThinkingEnabled` (env overrides when set). */
export function registerOllamaSettingsSource(getter: () => AppSettings): void {
  appSettingsGetter = getter;
  registerAppSettingsForProviderToggles(getter);
}

type OllamaChatResponse = {
  message?: {
    content?: string;
    /** Present on thinking-capable models when `think` was left enabled. */
    thinking?: string;
    reasoning?: string;
  };
};

function ollamaAssistantText(message: OllamaChatResponse["message"]): string {
  if (!message) return "";
  const raw =
    message.content?.trim() ||
    message.thinking?.trim() ||
    message.reasoning?.trim() ||
    "";
  return raw;
}

/** `think` field for Ollama `/api/chat`. Env `NOVA_OLLAMA_THINK` wins when set; otherwise uses Settings → Models. */
function ollamaThinkForApi(): boolean {
  const raw = process.env.NOVA_OLLAMA_THINK?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  try {
    return appSettingsGetter?.().models.ollamaThinkingEnabled === true;
  } catch {
    return false;
  }
}

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  private readonly model = process.env.OLLAMA_MODEL ?? "llama3.1";
  private readonly keepAlive = process.env.NOVA_OLLAMA_KEEP_ALIVE?.trim() || "30m";

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return {
        name: this.name,
        ok: response.ok,
        details: response.ok ? "reachable" : `status ${response.status}`
      };
    } catch (error) {
      return {
        name: this.name,
        ok: false,
        details: error instanceof Error ? error.message : "health check failed"
      };
    }
  }

  async chat(request: ChatRequest): Promise<ModelResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.model ?? this.model,
        messages: request.messages,
        stream: false,
        think: ollamaThinkForApi(),
        keep_alive: this.keepAlive,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 700
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ollama chat failed with status ${response.status}`);
    }
    const payload = (await response.json()) as OllamaChatResponse;
    const content = ollamaAssistantText(payload.message);
    if (!content) {
      throw new Error("ollama returned empty content");
    }
    return {
      provider: this.name,
      content,
      model: request.model ?? this.model
    };
  }

  async streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<ModelResponse> {
    const startedAt = Date.now();
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.model ?? this.model,
        messages: request.messages,
        stream: true,
        think: ollamaThinkForApi(),
        keep_alive: this.keepAlive,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 700
        }
      })
    });
    if (!response.ok || !response.body) {
      throw new Error(`ollama chat stream failed with status ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let firstTokenMs: number | undefined;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const payload = JSON.parse(trimmed) as {
            message?: { content?: string; thinking?: string; reasoning?: string };
            done?: boolean;
          };
          const token =
            payload.message?.content ??
            payload.message?.thinking ??
            payload.message?.reasoning ??
            "";
          if (!token) continue;
          if (firstTokenMs === undefined) {
            firstTokenMs = Date.now() - startedAt;
          }
          full += token;
          onToken(token);
        } catch {
          // ignore malformed line
        }
      }
    }
    if (!full.trim()) {
      throw new Error("ollama returned empty streamed content");
    }
    return {
      provider: this.name,
      content: full.trim(),
      model: request.model ?? this.model,
      firstTokenMs
    };
  }
}
