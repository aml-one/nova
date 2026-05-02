import type { RuntimeSkill } from "@nova/skills";

type Input = {
  query?: string;
  mode?: "search" | "ask";
  settings?: {
    baseUrl?: string;
    timeoutMs?: number;
    maxSources?: number;
    focusMode?: string;
    optimizationMode?: string;
    stream?: boolean;
  };
};

type Source = { title: string; url: string };

export const perplexicaWebsearchSkill: RuntimeSkill = {
  manifest: {
    id: "perplexica-websearch",
    name: "Perplexica Websearch",
    description:
      "Search the live web through a local Perplexica instance and return an answer with sources. Use for latest/current events, external references, and web lookups.",
    permissions: ["network"],
    version: "0.1.0",
    settingsTab: {
      id: "perplexica-websearch",
      label: "Perplexica Search",
      tone: "green",
      description: "Configure local/remote Perplexica endpoint and search defaults."
    }
  },
  async run(input: unknown): Promise<unknown> {
    const parsed = normalizeInput(input);
    if (!parsed.query) {
      throw new Error("query is required");
    }
    const settings = parsed.settings ?? {};
    const baseUrl = normalizeBaseUrl(settings.baseUrl || process.env.NOVA_PERPLEXICA_BASE_URL || "http://127.0.0.1:3008");
    const timeoutMs = clampInt(settings.timeoutMs, 1000, 120000, 30000);
    const maxSources = clampInt(settings.maxSources, 1, 20, 6);
    const focusMode = settings.focusMode?.trim() || "webSearch";
    const optimizationMode = settings.optimizationMode?.trim() || "speed";
    const response = await queryPerplexica({
      baseUrl,
      query: parsed.query,
      timeoutMs,
      focusMode,
      optimizationMode,
      stream: settings.stream === true
    });
    const sources = dedupeSources(response.sources).slice(0, maxSources);
    return {
      provider: "perplexica",
      baseUrl,
      query: parsed.query,
      answer: response.answer,
      sources,
      formatted: renderFormatted(response.answer, sources)
    };
  }
};

async function queryPerplexica(input: {
  baseUrl: string;
  query: string;
  timeoutMs: number;
  focusMode: string;
  optimizationMode: string;
  stream: boolean;
}): Promise<{ answer: string; sources: Source[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const candidates: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [
      {
        path: "/api/search",
        body: {
          chatModel: { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "llama3.1" },
          embeddingModel: { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "llama3.1" },
          optimizationMode: input.optimizationMode,
          focusMode: input.focusMode,
          query: input.query,
          history: [],
          stream: input.stream
        }
      },
      {
        path: "/api/search",
        body: {
          query: input.query,
          optimizationMode: input.optimizationMode,
          focusMode: input.focusMode
        }
      },
      {
        path: "/api/ask",
        body: {
          query: input.query,
          focusMode: input.focusMode
        }
      }
    ];

    let lastError = "unknown error";
    for (const candidate of candidates) {
      try {
        const response = await fetch(`${input.baseUrl}${candidate.path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(candidate.body),
          signal: controller.signal
        });
        if (!response.ok) {
          lastError = `HTTP ${response.status} at ${candidate.path}`;
          continue;
        }
        const payload = (await response.json()) as Record<string, unknown>;
        const answer = extractAnswer(payload).trim();
        const sources = extractSources(payload);
        if (answer) {
          return { answer, sources };
        }
        lastError = `no answer field at ${candidate.path}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`Perplexica request failed: ${lastError}`);
  } finally {
    clearTimeout(timer);
  }
}

function extractAnswer(payload: Record<string, unknown>): string {
  if (typeof payload.answer === "string") return payload.answer;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.response === "string") return payload.response;
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.result === "string") return payload.result;
  return "";
}

function extractSources(payload: Record<string, unknown>): Source[] {
  const candidates = [
    payload.sources,
    payload.sourceDocuments,
    payload.citations,
    payload.links
  ];
  for (const value of candidates) {
    if (!Array.isArray(value)) continue;
    const items = value
      .map((item) => {
        if (typeof item === "string") {
          return { title: item, url: item } as Source;
        }
        const row = item as Record<string, unknown>;
        const url = String(row.url ?? row.link ?? "").trim();
        const title = String(row.title ?? row.name ?? row.snippet ?? url).trim();
        if (!url) return null;
        return { title: title || url, url } as Source;
      })
      .filter((item): item is Source => Boolean(item));
    if (items.length > 0) {
      return items;
    }
  }
  return [];
}

function dedupeSources(items: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const item of items) {
    const key = item.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function renderFormatted(answer: string, sources: Source[]): string {
  const lines = [answer.trim()];
  if (sources.length > 0) {
    lines.push("", "Sources:");
    for (const [index, source] of sources.entries()) {
      lines.push(`${index + 1}. ${source.title} - ${source.url}`);
    }
  }
  return lines.join("\n");
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "http://127.0.0.1:3008";
  return trimmed.replace(/\/+$/, "");
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function normalizeInput(input: unknown): Required<Pick<Input, "mode">> & Input {
  const parsed = (input ?? {}) as Input;
  return {
    ...parsed,
    query: String(parsed.query ?? "").trim(),
    mode: parsed.mode ?? "search",
    settings: parsed.settings ?? {}
  };
}

export default perplexicaWebsearchSkill;
