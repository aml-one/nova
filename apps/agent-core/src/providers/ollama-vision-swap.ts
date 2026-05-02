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
