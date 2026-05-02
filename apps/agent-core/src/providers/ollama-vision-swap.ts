/** Ollama memory helpers for vision: free VRAM before loading another model. */

function trimBase(input: string): string {
  return input.replace(/\/+$/, "");
}

export function normalizeOllamaBaseUrl(baseUrl: string | undefined, fallback: string): string {
  const raw = (baseUrl ?? "").trim();
  return trimBase(raw.length > 0 ? raw : fallback);
}

/** Best-effort unload: Ollama evicts the model shortly after a zero keep-alive generate. */
export async function ollamaUnloadModel(baseUrl: string, model: string): Promise<void> {
  const base = normalizeOllamaBaseUrl(baseUrl, "http://127.0.0.1:11434");
  const m = model.trim();
  if (!m) return;
  try {
    await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: m,
        prompt: " ",
        stream: false,
        keep_alive: 0
      })
    });
  } catch {
    // ignore — swap is best-effort
  }
}

/**
 * After vision finishes and the vision model is unloaded, the default chat model is not in VRAM yet.
 * The next chat call can fail immediately and local-first falls through to Copilot. This runs a tiny
 * generate to pull the chat model back and retries with short gaps (configurable via env).
 */
export async function ollamaPrewarmChatModelAfterVisionSwap(baseUrl: string, chatModel: string): Promise<void> {
  const base = normalizeOllamaBaseUrl(baseUrl, "http://127.0.0.1:11434");
  const m = chatModel.trim();
  if (!m) return;
  const settleMs = Math.min(10_000, Math.max(0, Number(process.env.NOVA_OLLAMA_POST_VISION_SETTLE_MS ?? "500")));
  if (settleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  const attempts = Math.min(12, Math.max(1, Number(process.env.NOVA_OLLAMA_POST_VISION_WARM_ATTEMPTS ?? "5")));
  const gapMs = Math.min(5000, Math.max(100, Number(process.env.NOVA_OLLAMA_POST_VISION_WARM_GAP_MS ?? "450")));
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
    try {
      const response = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: m,
          prompt: ".",
          stream: false,
          options: { num_predict: 1 }
        })
      });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
  }
}
