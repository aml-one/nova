import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { normalizeOllamaBaseUrl } from "../providers/ollama-vision-swap.js";

/** Same base resolution as vision + env fallbacks (Settings → Vision → Ollama base URL, then env). */
export function resolveOllamaBaseForInventory(settings: AppSettings): string {
  const fromSettings = settings.vision?.ollamaBaseUrl?.trim();
  if (fromSettings) return normalizeOllamaBaseUrl(fromSettings, "http://127.0.0.1:11434");
  return normalizeOllamaBaseUrl(
    process.env.OLLAMA_VISION_BASE_URL || process.env.OLLAMA_BASE_URL,
    "http://127.0.0.1:11434"
  );
}

export function detectOllamaInventoryIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length === 0 || t.length > 6000) return false;
  if (/\bollama\s+list\b/.test(t)) return true;
  if (t.includes("/api/tags")) return true;
  if (/\bwhat\s+models?\b/.test(t) && /\bollama\b/.test(t)) return true;
  if (/\bwhich\s+models?\b/.test(t) && /\bollama\b/.test(t)) return true;
  if (/\b(list|show)\b.*\b(models?|tags?)\b.*\bollama\b/.test(t)) return true;
  if (/\bollama\b.*\b(list|show)\b.*\b(models?|tags?)\b/.test(t)) return true;
  if (/\bwhat\s+model\b/.test(t) && /\bollama\b/.test(t)) return true;
  if (/\bmodel\b.*\b(load|loaded|running|installed)\b/.test(t) && /\bollama\b/.test(t)) return true;
  if (/\bollama\b.*\b(load|loaded|running|installed|available)\b/.test(t)) return true;
  if (/\bhow\s+many\s+models?\b/.test(t) && /\bollama\b/.test(t)) return true;
  if (/\brun\s+ollama\b/.test(t)) return true;
  if (t.length < 180 && /\byou\s+run\s+(the\s+)?command\b/i.test(t)) return true;
  return false;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: ac.signal });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatBytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

/**
 * Returns markdown for the user, or empty string if the API could not be reached.
 */
export async function buildOllamaInventoryMarkdown(settings: AppSettings): Promise<{ markdown: string; baseUrl: string }> {
  const baseUrl = resolveOllamaBaseForInventory(settings);
  const tagsPayload = (await fetchJson(`${baseUrl}/api/tags`, 12_000)) as {
    models?: Array<{ name?: string; size?: number; modified_at?: string }>;
  } | null;
  if (!tagsPayload || !Array.isArray(tagsPayload.models)) {
    return { markdown: "", baseUrl };
  }
  const installed = tagsPayload.models
    .map((m) => {
      const name = m.name?.trim();
      if (!name) return null;
      const size = formatBytes(m.size);
      const mod = typeof m.modified_at === "string" ? m.modified_at : "";
      const bits = [name, size && `size ${size}`, mod && `modified ${mod}`].filter(Boolean);
      return `- ${bits.join(" · ")}`;
    })
    .filter((line): line is string => Boolean(line));

  let runningSection = "";
  const psPayload = (await fetchJson(`${baseUrl}/api/ps`, 8000)) as {
    models?: Array<{ name?: string; model?: string; size?: number; size_vram?: number; expires_at?: string }>;
  } | null;
  if (psPayload && Array.isArray(psPayload.models) && psPayload.models.length > 0) {
    const lines = psPayload.models
      .map((m) => {
        const name = (m.name ?? m.model ?? "").trim();
        if (!name) return null;
        const vram = m.size_vram != null ? `VRAM ${formatBytes(m.size_vram)}` : "";
        const total = m.size != null ? `total ${formatBytes(m.size)}` : "";
        const exp = typeof m.expires_at === "string" ? m.expires_at : "";
        const bits = [name, vram, total, exp && `expires ${exp}`].filter(Boolean);
        return `- ${bits.join(" · ")}`;
      })
      .filter((line): line is string => Boolean(line));
    if (lines.length) {
      runningSection = `\n### Currently loaded in Ollama (\`GET /api/ps\`)\n${lines.join("\n")}\n`;
    }
  }

  const installedBlock =
    installed.length > 0
      ? installed.join("\n")
      : "_Ollama returned an empty model list from `/api/tags` (no entries)._";
  const md = `### Installed Ollama models (\`GET /api/tags\`)\n${installedBlock}\n${runningSection}`;
  return { markdown: md.trimEnd(), baseUrl };
}

export function formatOllamaInventoryReply(params: {
  baseUrl: string;
  markdown: string;
  defaultChatModel: string;
  activeProvider: string;
}): string {
  const modelLine = params.defaultChatModel.trim()
    ? `**Nova default Ollama chat model (Settings → Models):** \`${params.defaultChatModel.trim()}\``
    : "**Nova default Ollama chat model:** _(not set — use Settings → Models or env)_";
  return (
    `Nova queried your Ollama HTTP API at **${params.baseUrl}** (live data — not generated terminal output).\n\n` +
    `${params.markdown}\n\n` +
    `---\n` +
    `${modelLine}\n` +
    `**Active routing provider:** \`${params.activeProvider}\`\n\n` +
    `_If this list does not match your machine, the base URL above may point at a different host than your terminal._`
  );
}
