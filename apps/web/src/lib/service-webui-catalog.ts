export type ServiceWebUiEntry = {
  id: string;
  title: string;
  description: string;
  /** HTTP port on Nova host (use with basePath). Omit when sameOriginPath is set. */
  port?: number;
  /** Embed this Nova web route on the same origin (e.g. /memory). Omit when port is set. */
  sameOriginPath?: string;
  /** Path on that port (must start with /). Ignored for sameOrigin entries. */
  basePath?: string;
};

function normalizeBasePath(path: string | undefined): string {
  const p = (path ?? "/").trim();
  if (!p.startsWith("/")) return `/${p}`;
  return p;
}

function normalizeSameOriginPath(path: string): string {
  const p = path.trim();
  if (!p.startsWith("/")) return `/${p}`;
  return p || "/";
}

function entryKey(e: ServiceWebUiEntry): string {
  if (e.sameOriginPath) return `origin:${normalizeSameOriginPath(e.sameOriginPath)}`;
  const port = e.port ?? 0;
  return `port:${port}:${normalizeBasePath(e.basePath)}`;
}

function normalizeEntry(e: ServiceWebUiEntry): ServiceWebUiEntry {
  if (e.sameOriginPath) {
    return { ...e, sameOriginPath: normalizeSameOriginPath(e.sameOriginPath) };
  }
  return {
    ...e,
    port: e.port,
    basePath: normalizeBasePath(e.basePath)
  };
}

/** Absolute URL for embedding `entry` from the browser (same tab origin vs host:port). */
export function serviceEmbedUrl(
  entry: ServiceWebUiEntry,
  opts: { origin: string; protocol: string; hostname: string }
): string {
  const e = normalizeEntry(entry);
  if (e.sameOriginPath) return `${opts.origin}${e.sameOriginPath}`;
  if (e.port === undefined) return opts.origin;
  return `${opts.protocol}//${opts.hostname}:${e.port}${normalizeBasePath(e.basePath)}`;
}

/**
 * Defaults when `NOVA_SERVICE_WEBUIS_JSON` is unset.
 * Ports match common Nova docs (Perplexica skill 3008, MemoryBear example 8000, Ollama 11434).
 */
export const BUILTIN_SERVICE_WEBUIS: ServiceWebUiEntry[] = [
  {
    id: "nova-memory",
    sameOriginPath: "/memory",
    title: "Nova · Memory cards",
    description:
      "Nova’s Memory UI (cards / MemoryService in this app). Same origin — works over LAN with your Nova URL."
  },
  {
    id: "perplexica",
    port: 3008,
    title: "Perplexica",
    description:
      "Local search UI default from Perplexica skill (`NOVA_PERPLEXICA_BASE_URL`). Change port via NOVA_SERVICE_WEBUIS_JSON if yours differs.",
    basePath: "/"
  },
  {
    id: "memorybear",
    port: 8000,
    title: "MemoryBear (typical)",
    description:
      "Example API port from Settings placeholder — MemoryBear may expose a UI here depending on install; override JSON if needed.",
    basePath: "/"
  },
  {
    id: "ollama",
    port: 11434,
    title: "Ollama",
    description:
      "Default Ollama HTTP API (`OLLAMA_BASE_URL`). Usually JSON API only — Open WebUI or another dashboard is often a different port.",
    basePath: "/"
  },
  {
    id: "port-5005",
    port: 5005,
    title: "Web UI · port 5005",
    description:
      "Companion dashboard on port 5005 (same host as Nova). Extend or replace entries with NOVA_SERVICE_WEBUIS_JSON.",
    basePath: "/"
  }
];

/** Merge env JSON over builtins (unique by origin path or port+basePath). */
export function mergeServiceWebUiCatalog(envJson: string | undefined): ServiceWebUiEntry[] {
  let extra: Partial<ServiceWebUiEntry>[] = [];
  if (envJson?.trim()) {
    try {
      const parsed = JSON.parse(envJson) as unknown;
      if (Array.isArray(parsed)) extra = parsed as Partial<ServiceWebUiEntry>[];
    } catch {
      /* ignore invalid JSON */
    }
  }

  const parseRow = (row: Partial<ServiceWebUiEntry>, i: number): ServiceWebUiEntry | undefined => {
    const title =
      typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Service";
    const description =
      typeof row.description === "string" && row.description.trim()
        ? row.description.trim()
        : "Embedded Web UI.";
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `custom-${i}`;
    const so =
      typeof row.sameOriginPath === "string" && row.sameOriginPath.trim()
        ? normalizeSameOriginPath(row.sameOriginPath.trim())
        : undefined;
    const port = typeof row.port === "number" && Number.isFinite(row.port) && row.port > 0 && row.port < 65536 ? row.port : undefined;
    if (so) {
      return { id, title, description, sameOriginPath: so };
    }
    if (port !== undefined) {
      return { id, title, description, port, basePath: normalizeBasePath(row.basePath) };
    }
    return undefined;
  };

  const seen = new Set<string>();
  const out: ServiceWebUiEntry[] = [];

  const push = (e: ServiceWebUiEntry): void => {
    const n = normalizeEntry(e);
    const k = entryKey(n);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(n);
  };

  for (let i = 0; i < extra.length; i++) {
    const parsed = parseRow(extra[i] ?? {}, i);
    if (parsed) push(parsed);
  }

  if (extra.length === 0) {
    return BUILTIN_SERVICE_WEBUIS.map((e) => normalizeEntry(e));
  }

  for (const b of BUILTIN_SERVICE_WEBUIS) {
    push(b);
  }

  return out.sort((a, b) => {
    const ao = a.sameOriginPath ? 0 : 1;
    const bo = b.sameOriginPath ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const pa = a.port ?? 1_000_000;
    const pb = b.port ?? 1_000_000;
    return pa - pb || a.title.localeCompare(b.title);
  });
}
