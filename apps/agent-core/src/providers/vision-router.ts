import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { readUploadedMediaBytes } from "../media/media-storage.js";
import { lmstudioOpenAiBaseToRestRoot, lmstudioUnloadModel } from "./lmstudio-vision-swap.js";
import { normalizeOllamaBaseUrl, ollamaUnloadModel } from "./ollama-vision-swap.js";

type VisionRequest = {
  userPrompt: string;
  imageUrl?: string;
};

export type VisionResult = {
  used: boolean;
  provider?: string;
  summary?: string;
};

type VisionLane = "lmstudio" | "ollama" | "cloud";

export class VisionRouter {
  hasConfiguredProvider(settings: AppSettings): boolean {
    return (
      lmstudioVisionConfigured(settings) || ollamaVisionConfigured(settings) || cloudVisionConfigured(settings)
    );
  }

  /** Read-only snapshot for troubleshooting vision routing (no upstream calls). */
  buildDebugSnapshot(settings: AppSettings): Record<string, unknown> {
    return buildVisionDebugSnapshot(settings);
  }

  async analyze(request: VisionRequest, settings: AppSettings): Promise<VisionResult> {
    const order = normalizeVisionOrder(settings.visionProviderPriority);
    for (const lane of order) {
      // Exactly one lane per iteration — previously three separate `if`s caused cloud (or LM Studio)
      // to run in the same pass as Ollama when Ollama returned empty or threw, ignoring priority.
      if (lane === "lmstudio" && lmstudioVisionConfigured(settings)) {
        try {
          const visionBase = resolveLmstudioVisionBase(settings);
          const visionModel = resolveLmstudioVisionModel(settings);
          const runVision = (): Promise<string> =>
            analyzeViaOpenAICompatible({
              endpoint: `${visionBase}/chat/completions`,
              model: visionModel,
              userPrompt: request.userPrompt,
              imageUrl: request.imageUrl
            });
          const summary = await runWithOptionalLmStudioSwap(settings, visionBase, visionModel, runVision);
          if (summary.trim()) {
            return { used: true, provider: "lmstudio", summary: summary.trim() };
          }
        } catch {
          // try next lane in order
        }
      } else if (lane === "ollama" && ollamaVisionConfigured(settings)) {
        try {
          const baseUrl = resolveOllamaVisionBase(settings);
          const model = resolveOllamaVisionModel(settings);
          const runVision = (): Promise<string> =>
            analyzeViaOllama({
              baseUrl,
              model,
              userPrompt: request.userPrompt,
              imageUrl: request.imageUrl
            });
          const summary = await runWithOptionalOllamaSwap(settings, baseUrl, model, runVision);
          if (summary.trim()) {
            return { used: true, provider: "ollama", summary: summary.trim() };
          }
        } catch {
          // try next lane in order
        }
      } else if (lane === "cloud" && cloudVisionConfigured(settings)) {
        try {
          const summary = await analyzeViaOpenAICompatible({
            endpoint: `${resolveCloudVisionBase(settings)}/chat/completions`,
            model: resolveCloudVisionModel(settings),
            apiKey: resolveCloudVisionApiKey(settings),
            userPrompt: request.userPrompt,
            imageUrl: request.imageUrl
          });
          if (summary.trim()) {
            return { used: true, provider: "cloud", summary: summary.trim() };
          }
        } catch {
          // try next lane in order
        }
      }
    }
    return { used: false };
  }
}

export function buildVisionDebugSnapshot(settings: AppSettings): Record<string, unknown> {
  const mask = (s: string) => {
    const t = s.trim();
    if (t.length <= 12) return t ? "[set]" : "";
    return `${t.slice(0, 8)}…${t.slice(-4)}`;
  };
  return {
    visionProviderPriority: settings.visionProviderPriority,
    hasConfiguredProvider:
      lmstudioVisionConfigured(settings) || ollamaVisionConfigured(settings) || cloudVisionConfigured(settings),
    activeChatProvider: settings.activeProvider,
    ollamaChatDisabled: settings.ollama.disabled === true,
    lmstudioChatDisabled: settings.lmstudio.disabled === true,
    copilotChatDisabled: settings.copilot.disabled === true,
    lanes: {
      lmstudio: {
        configured: lmstudioVisionConfigured(settings),
        baseUrl: mask(resolveLmstudioVisionBase(settings)),
        model: resolveLmstudioVisionModel(settings)
      },
      ollama: {
        configured: ollamaVisionConfigured(settings),
        baseUrl: mask(resolveOllamaVisionBase(settings)),
        model: resolveOllamaVisionModel(settings)
      },
      cloud: {
        configured: cloudVisionConfigured(settings),
        baseUrl: mask(resolveCloudVisionBase(settings)),
        model: resolveCloudVisionModel(settings),
        hasApiKey: Boolean(resolveCloudVisionApiKey(settings))
      }
    },
    swapLocalModelsForVision: settings.vision?.swapLocalModelsForVision === true
  };
}

function normalizeVisionOrder(
  priority: Array<VisionLane> | undefined
): Array<VisionLane> {
  const defaults: Array<VisionLane> = ["lmstudio", "ollama", "cloud"];
  const raw = Array.isArray(priority) && priority.length > 0 ? priority : defaults;
  const seen = new Set<VisionLane>();
  const out: Array<VisionLane> = [];
  for (const item of raw) {
    if (item === "lmstudio" || item === "ollama" || item === "cloud") {
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  for (const d of defaults) {
    if (!seen.has(d)) out.push(d);
  }
  return out;
}

function lmstudioVisionConfigured(settings: AppSettings): boolean {
  const v = settings.vision;
  return Boolean(
    (v?.lmstudioModel?.trim() ?? "") ||
      (v?.lmstudioBaseUrl?.trim() ?? "") ||
      (settings.lmstudio.disabled !== true && settings.models.defaultByProvider.lmstudio.trim()) ||
      process.env.LMSTUDIO_VISION_MODEL ||
      process.env.LMSTUDIO_VISION_BASE_URL ||
      (settings.lmstudio.disabled !== true && process.env.LMSTUDIO_MODEL)
  );
}

function ollamaVisionConfigured(settings: AppSettings): boolean {
  const v = settings.vision;
  return Boolean(
    (v?.ollamaModel?.trim() ?? "") ||
      (v?.ollamaBaseUrl?.trim() ?? "") ||
      (settings.ollama.disabled !== true && settings.models.defaultByProvider.ollama.trim()) ||
      process.env.OLLAMA_VISION_MODEL ||
      process.env.OLLAMA_VISION_BASE_URL ||
      (settings.ollama.disabled !== true && process.env.OLLAMA_MODEL)
  );
}

function cloudVisionConfigured(settings: AppSettings): boolean {
  const v = settings.vision;
  const base = (v?.cloudBaseUrl?.trim() ?? "") || (process.env.CLOUD_VISION_BASE_URL ?? "").trim();
  const model = (v?.cloudModel?.trim() ?? "") || (process.env.CLOUD_VISION_MODEL ?? "").trim();
  const key = (v?.cloudApiKey?.trim() ?? "") || (process.env.CLOUD_VISION_API_KEY ?? "").trim();
  return Boolean(base && model && key);
}

function resolveLmstudioVisionBase(settings: AppSettings): string {
  const fromSettings = settings.vision?.lmstudioBaseUrl?.trim();
  if (fromSettings) return fromSettings.replace(/\/+$/, "");
  const fromEnv = process.env.LMSTUDIO_VISION_BASE_URL ?? process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1";
  return fromEnv.replace(/\/+$/, "");
}

function resolveLmstudioVisionModel(settings: AppSettings): string {
  return (
    settings.vision?.lmstudioModel?.trim() ||
    settings.models.defaultByProvider.lmstudio.trim() ||
    process.env.LMSTUDIO_VISION_MODEL ||
    process.env.LMSTUDIO_MODEL ||
    "local-vision-model"
  );
}

function resolveOllamaVisionBase(settings: AppSettings): string {
  const fromSettings = settings.vision?.ollamaBaseUrl?.trim();
  if (fromSettings) return normalizeOllamaBaseUrl(fromSettings, "http://127.0.0.1:11434");
  return normalizeOllamaBaseUrl(
    process.env.OLLAMA_VISION_BASE_URL || process.env.OLLAMA_BASE_URL,
    "http://127.0.0.1:11434"
  );
}

function resolveOllamaVisionModel(settings: AppSettings): string {
  return (
    settings.vision?.ollamaModel?.trim() ||
    settings.models.defaultByProvider.ollama.trim() ||
    process.env.OLLAMA_VISION_MODEL ||
    process.env.OLLAMA_MODEL ||
    "llava"
  );
}

function resolveChatOllamaBase(settings: AppSettings): string {
  return normalizeOllamaBaseUrl(process.env.OLLAMA_BASE_URL, "http://127.0.0.1:11434");
}

function resolveChatOllamaModel(settings: AppSettings): string {
  return settings.models.defaultByProvider.ollama.trim() || process.env.OLLAMA_MODEL || "llama3.1";
}

function resolveChatLmstudioOpenAiBase(): string {
  return (process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/+$/, "");
}

function resolveChatLmstudioModel(settings: AppSettings): string {
  return settings.models.defaultByProvider.lmstudio.trim() || process.env.LMSTUDIO_MODEL || "local-model";
}

function resolveCloudVisionBase(settings: AppSettings): string {
  return (settings.vision?.cloudBaseUrl?.trim() || process.env.CLOUD_VISION_BASE_URL || "").replace(/\/+$/, "");
}

function resolveCloudVisionModel(settings: AppSettings): string {
  return settings.vision?.cloudModel?.trim() || process.env.CLOUD_VISION_MODEL || "gpt-4o-mini";
}

function resolveCloudVisionApiKey(settings: AppSettings): string | undefined {
  const k = settings.vision?.cloudApiKey?.trim() || process.env.CLOUD_VISION_API_KEY;
  return k || undefined;
}

async function runWithOptionalLmStudioSwap(
  settings: AppSettings,
  visionOpenAiBase: string,
  visionModel: string,
  runVision: () => Promise<string>
): Promise<string> {
  const swap = settings.vision?.swapLocalModelsForVision === true;
  const chatOnLm = settings.activeProvider === "lmstudio" && settings.lmstudio.disabled !== true;
  if (!swap || !chatOnLm) {
    return runVision();
  }
  const chatOpenAi = resolveChatLmstudioOpenAiBase();
  const chatModel = resolveChatLmstudioModel(settings);
  const restVision = lmstudioOpenAiBaseToRestRoot(visionOpenAiBase);
  const restChat = lmstudioOpenAiBaseToRestRoot(chatOpenAi);
  if (restVision !== restChat) {
    return runVision();
  }
  if (!chatModel || chatModel === visionModel) {
    return runVision();
  }
  await lmstudioUnloadModel(restChat, chatModel);
  try {
    return await runVision();
  } finally {
    await lmstudioUnloadModel(restVision, visionModel);
  }
}

async function runWithOptionalOllamaSwap(
  settings: AppSettings,
  visionBase: string,
  visionModel: string,
  runVision: () => Promise<string>
): Promise<string> {
  const swap = settings.vision?.swapLocalModelsForVision === true;
  const chatOnOllama =
    settings.activeProvider === "ollama" && settings.ollama.disabled !== true;
  if (!swap || !chatOnOllama) {
    return runVision();
  }
  const chatBase = resolveChatOllamaBase(settings);
  const chatModel = resolveChatOllamaModel(settings);
  const vBase = normalizeOllamaBaseUrl(visionBase, chatBase);
  const cBase = normalizeOllamaBaseUrl(chatBase, visionBase);
  if (vBase !== cBase) {
    return runVision();
  }
  if (!chatModel || chatModel === visionModel) {
    return runVision();
  }
  await ollamaUnloadModel(cBase, chatModel);
  try {
    return await runVision();
  } finally {
    await ollamaUnloadModel(vBase, visionModel);
  }
}

async function analyzeViaOpenAICompatible(input: {
  endpoint: string;
  model: string;
  userPrompt: string;
  imageUrl?: string;
  apiKey?: string;
}): Promise<string> {
  if (!input.endpoint.startsWith("http")) {
    throw new Error("vision endpoint not configured");
  }
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    { type: "text", text: input.userPrompt }
  ];
  const imageUrlForApi = resolveVisionImageUrlForOpenAi(input.imageUrl);
  if (input.imageUrl?.trim() && !imageUrlForApi) {
    throw new Error("could not resolve image for OpenAI-compatible vision");
  }
  if (imageUrlForApi) {
    content.push({ type: "image_url", image_url: { url: imageUrlForApi } });
  }
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content }],
      temperature: 0.2
    })
  });
  if (!response.ok) {
    throw new Error(`vision provider failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content ?? "";
}

async function analyzeViaOllama(input: {
  baseUrl: string;
  model: string;
  userPrompt: string;
  imageUrl?: string;
}): Promise<string> {
  const base = normalizeOllamaBaseUrl(input.baseUrl, "http://127.0.0.1:11434");
  const imageBase64 = await resolveOllamaImageBase64(input.imageUrl);
  if (input.imageUrl?.trim() && !imageBase64) {
    throw new Error("could not load image bytes for Ollama vision");
  }
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      messages: [
        {
          role: "user",
          content: input.userPrompt,
          images: imageBase64 ? [imageBase64] : []
        }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`ollama vision failed (${response.status})`);
  }
  const payload = (await response.json()) as { message?: { content?: string } };
  return payload.message?.content ?? "";
}

async function resolveOllamaImageBase64(imageUrl: string | undefined): Promise<string | undefined> {
  const raw = imageUrl?.trim();
  if (!raw) return undefined;
  if (raw.startsWith("data:")) {
    const comma = raw.indexOf(",");
    if (comma > 0) {
      const payload = raw.slice(comma + 1).trim();
      if (payload.length > 0) return payload;
    }
  }
  // Already base64 payload from callers that pre-encode.
  if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length > 128) {
    return raw;
  }
  const fromDisk = readUploadedMediaBytes(raw);
  if (fromDisk) {
    return fromDisk.buffer.toString("base64");
  }
  const local = normalizeLocalMediaPath(raw);
  const target = local.startsWith("http") ? local : `${resolveAgentBaseUrl()}${local}`;
  try {
    const response = await fetch(target);
    if (!response.ok) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.toString("base64");
  } catch {
    return undefined;
  }
}

/** LM Studio / OpenAI-compatible vision: prefer data URL from disk; else absolute URL only for known media paths. */
function resolveVisionImageUrlForOpenAi(imageUrl: string | undefined): string | undefined {
  const raw = imageUrl?.trim();
  if (!raw) return undefined;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  if (raw.startsWith("data:")) {
    return raw;
  }
  const fromDisk = readUploadedMediaBytes(raw);
  if (fromDisk) {
    return `data:${fromDisk.contentType};base64,${fromDisk.buffer.toString("base64")}`;
  }
  const local = normalizeLocalMediaPath(raw);
  if (local.startsWith("/v1/media/files/")) {
    return `${resolveAgentBaseUrl()}${local}`;
  }
  return undefined;
}

function resolveAgentBaseUrl(): string {
  const port = Number(process.env.NOVA_AGENT_PORT ?? "8787");
  const safePort = Number.isFinite(port) && port > 0 ? port : 8787;
  return `http://127.0.0.1:${safePort}`;
}

function normalizeLocalMediaPath(url: string): string {
  if (url.startsWith("/api/media/files/")) {
    return `/v1/media/files/${url.slice("/api/media/files/".length)}`;
  }
  return url;
}
