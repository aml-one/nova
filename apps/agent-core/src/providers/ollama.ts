import type { ChatRequest, ModelProvider, ModelResponse, ProviderHealth } from "@nova/sdk/provider";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { registerAppSettingsForProviderToggles } from "./provider-integration.js";
import { normalizeOllamaNativeApiBase } from "./ollama-vision-swap.js";

let appSettingsGetter: (() => AppSettings) | undefined;

/** Call from bootstrap so Ollama can read `models.ollamaThinkingEnabled` (env overrides when set). */
export function registerOllamaSettingsSource(getter: () => AppSettings): void {
  appSettingsGetter = getter;
  registerAppSettingsForProviderToggles(getter);
}

const OLLAMA_DISABLED_MODEL_SENTINEL = "__nova_ollama_provider_disabled__";
const TAGS_CACHE_MS = 30_000;
const tagsCache = new Map<string, { at: number; names: string[] }>();

/**
 * Base URL for native Ollama `/api/tags`, `/api/chat`, etc.
 * Uses `OLLAMA_BASE_URL` when set; otherwise **Settings → Vision → Ollama vision base URL** (same host many users configure once).
 */
export function resolveOllamaNativeApiBaseUrl(): string {
  let raw = process.env.OLLAMA_BASE_URL?.trim() ?? "";
  if (!raw) {
    try {
      raw = appSettingsGetter?.().vision.ollamaBaseUrl?.trim() ?? "";
    } catch {
      // ignore
    }
  }
  return normalizeOllamaNativeApiBase(raw || undefined, "http://127.0.0.1:11434");
}

async function fetchOllamaModelNames(baseUrl: string): Promise<string[]> {
  const now = Date.now();
  const prev = tagsCache.get(baseUrl);
  if (prev && now - prev.at < TAGS_CACHE_MS) {
    return prev.names;
  }
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      tagsCache.set(baseUrl, { at: now, names: [] });
      return [];
    }
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models ?? [])
      .map((m) => m.name?.trim())
      .filter((x): x is string => Boolean(x));
    tagsCache.set(baseUrl, { at: now, names });
    return names;
  } catch {
    tagsCache.set(baseUrl, { at: now, names: [] });
    return [];
  }
}

function pickFallbackModelFromTags(requested: string, names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.includes(requested)) return requested;
  const bare = requested.split(":")[0] ?? requested;
  const byPrefix = names.find((n) => n === bare || n.startsWith(`${bare}:`));
  if (byPrefix) return byPrefix;
  return names[0] ?? null;
}

async function readHttpErrorHint(response: Response): Promise<string> {
  const bodyText = await response.text();
  let hint = bodyText.slice(0, 400).replace(/\s+/g, " ").trim();
  try {
    const errJson = JSON.parse(bodyText) as { error?: string };
    if (typeof errJson.error === "string" && errJson.error.trim()) {
      hint = errJson.error.trim();
    }
  } catch {
    // keep truncated body
  }
  return hint ? `: ${hint}` : "";
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
  const raw =
    message?.content?.trim() ||
    message?.thinking?.trim() ||
    message?.reasoning?.trim() ||
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

function buildOllamaChatBody(modelId: string, request: ChatRequest, stream: boolean): string {
  return JSON.stringify({
    model: modelId,
    messages: request.messages,
    stream,
    think: ollamaThinkForApi(),
    keep_alive: ollamaKeepAliveForApi(),
    options: {
      temperature: request.temperature ?? 0.2,
      num_predict: ollamaNumPredict(request.maxTokens)
    }
  });
}

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";

  private getDefaultModelId(): string {
    const env = process.env.OLLAMA_MODEL?.trim() ?? "";
    let fromSettings = "";
    try {
      fromSettings = appSettingsGetter?.().models.defaultByProvider.ollama?.trim() ?? "";
    } catch {
      // ignore
    }
    const raw = fromSettings || env;
    if (!raw || raw === OLLAMA_DISABLED_MODEL_SENTINEL) {
      return env || "llama3.1";
    }
    return raw;
  }

  private resolveModelForRequest(requested: string | undefined): string {
    const t = requested?.trim();
    if (t && t !== OLLAMA_DISABLED_MODEL_SENTINEL) return t;
    return this.getDefaultModelId();
  }

  private async postChat(baseUrl: string, modelId: string, request: ChatRequest, stream: boolean): Promise<Response> {
    return fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: buildOllamaChatBody(modelId, request, stream)
    });
  }

  /** If `/api/chat` returns 404 (unknown model), retry once using a name from `/api/tags`. */
  private async postChatWithModelFallback(
    baseUrl: string,
    request: ChatRequest,
    stream: boolean
  ): Promise<{ response: Response; modelId: string }> {
    let modelId = this.resolveModelForRequest(request.model);
    let response = await this.postChat(baseUrl, modelId, request, stream);
    if (response.status === 404) {
      const names = await fetchOllamaModelNames(baseUrl);
      const fb = pickFallbackModelFromTags(modelId, names);
      if (fb && fb !== modelId) {
        modelId = fb;
        response = await this.postChat(baseUrl, modelId, request, stream);
      }
    }
    return { response, modelId };
  }

  async health(): Promise<ProviderHealth> {
    try {
      const baseUrl = resolveOllamaNativeApiBaseUrl();
      const response = await fetch(`${baseUrl}/api/tags`);
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
    const baseUrl = resolveOllamaNativeApiBaseUrl();
    const { response, modelId } = await this.postChatWithModelFallback(baseUrl, request, false);
    if (!response.ok) {
      const hint = await readHttpErrorHint(response);
      throw new Error(`ollama chat failed with status ${response.status}${hint}`);
    }
    const payload = (await response.json()) as OllamaChatResponse;
    const content = ollamaAssistantText(payload.message);
    if (!content) {
      throw new Error("ollama returned empty content");
    }
    return {
      provider: this.name,
      content,
      model: modelId
    };
  }

  async streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<ModelResponse> {
    const startedAt = Date.now();
    const baseUrl = resolveOllamaNativeApiBaseUrl();
    const { response, modelId } = await this.postChatWithModelFallback(baseUrl, request, true);
    if (!response.ok) {
      const hint = await readHttpErrorHint(response);
      throw new Error(`ollama chat stream failed with status ${response.status}${hint}`);
    }
    if (!response.body) {
      throw new Error(`ollama chat stream failed with status ${response.status}: empty body`);
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
      model: modelId,
      firstTokenMs
    };
  }
}
