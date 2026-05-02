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

/**
 * Ollama `options.num_predict`. Priority: `request.maxTokens` → `NOVA_OLLAMA_NUM_PREDICT` → Settings → 8192.
 * `-1` uses Ollama/model default.
 */
function ollamaNumPredict(requestMax?: number): number {
  if (requestMax != null && Number.isFinite(requestMax)) {
    const n = Math.trunc(requestMax);
    if (n > 0) return n;
    if (n === -1) return -1;
  }
  const envRaw = process.env.NOVA_OLLAMA_NUM_PREDICT?.trim();
  if (envRaw !== undefined && envRaw !== "") {
    const parsed = Number(envRaw);
    if (!Number.isFinite(parsed)) return 8192;
    if (parsed === 0) return 8192;
    return Math.trunc(parsed);
  }
  try {
    const v = appSettingsGetter?.().ollama.numPredict;
    if (typeof v === "number" && Number.isFinite(v)) {
      const n = Math.trunc(v);
      if (n === -1) return -1;
      if (n >= 1) return Math.min(131072, n);
    }
  } catch {
    // ignore
  }
  return 8192;
}

/** Priority: `NOVA_OLLAMA_KEEP_ALIVE` → Settings → `30m`. */
function ollamaKeepAliveForApi(): string {
  const env = process.env.NOVA_OLLAMA_KEEP_ALIVE?.trim();
  if (env) return env.slice(0, 32);
  try {
    const s = appSettingsGetter?.().ollama.keepAlive?.trim();
    if (s) return s.slice(0, 32);
  } catch {
    // ignore
  }
  return "30m";
}

function appendOllamaSseJsonLine(
  trimmed: string,
  startedAt: number,
  onToken: (token: string) => void,
  state: { full: string; firstTokenMs?: number }
): void {
  if (!trimmed) return;
  try {
    const payload = JSON.parse(trimmed) as {
      message?: { content?: string; thinking?: string; reasoning?: string };
      done?: boolean;
    };
    const token =
      payload.message?.content ?? payload.message?.thinking ?? payload.message?.reasoning ?? "";
    if (!token) return;
    if (state.firstTokenMs === undefined) {
      state.firstTokenMs = Date.now() - startedAt;
    }
    state.full += token;
    onToken(token);
  } catch {
    // ignore malformed line
  }
}

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  private readonly model = process.env.OLLAMA_MODEL ?? "llama3.1";

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
        keep_alive: ollamaKeepAliveForApi(),
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: ollamaNumPredict(request.maxTokens)
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
        keep_alive: ollamaKeepAliveForApi(),
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: ollamaNumPredict(request.maxTokens)
        }
      })
    });
    if (!response.ok || !response.body) {
      throw new Error(`ollama chat stream failed with status ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const state = { full: "", firstTokenMs: undefined as number | undefined };
    while (true) {
      const { value, done } = await reader.read();
      if (value?.byteLength) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          appendOllamaSseJsonLine(line.trim(), startedAt, onToken, state);
        }
      }
      if (done) break;
    }
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) {
      appendOllamaSseJsonLine(line.trim(), startedAt, onToken, state);
    }
    buffer = "";
    const full = state.full;
    const firstTokenMs = state.firstTokenMs;
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
