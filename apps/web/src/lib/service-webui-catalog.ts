export type ServiceWebUiEntry = {
  id: string;
  port: number;
  title: string;
  description: string;
  /** Path on that port (must start with /). */
  basePath?: string;
};

/** Default embedded targets when `NOVA_SERVICE_WEBUIS_JSON` is unset — extend via env on the web server. */
export const BUILTIN_SERVICE_WEBUIS: ServiceWebUiEntry[] = [
  {
    id: "port-5005",
    port: 5005,
    title: "Web UI · port 5005",
    description:
      "Companion service on port 5005 (same host as this Nova site). Replace or extend the list with NOVA_SERVICE_WEBUIS_JSON.",
    basePath: "/"
  }
];

function normalizeBasePath(path: string | undefined): string {
  const p = (path ?? "/").trim();
  if (!p.startsWith("/")) return `/${p}`;
  return p;
}

/** Merge env JSON entries over builtins (matched by port + basePath or id). */
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
  if (extra.length === 0) return BUILTIN_SERVICE_WEBUIS.map((e) => ({ ...e, basePath: normalizeBasePath(e.basePath) }));

  const valid = extra
    .filter((row): row is ServiceWebUiEntry => typeof row.port === "number" && Number.isFinite(row.port) && row.port > 0 && row.port < 65536)
    .map((row, i) => ({
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `custom-${row.port}-${i}`,
      port: row.port,
      title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : `Port ${row.port}`,
      description:
        typeof row.description === "string" && row.description.trim()
          ? row.description.trim()
          : `HTTP UI on port ${row.port}.`,
      basePath: normalizeBasePath(row.basePath)
    }));

  const seen = new Set<string>();
  const out: ServiceWebUiEntry[] = [];
  for (const row of valid) {
    const key = `${row.port}:${row.basePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  for (const b of BUILTIN_SERVICE_WEBUIS) {
    const bp = normalizeBasePath(b.basePath);
    const key = `${b.port}:${bp}`;
    if (!seen.has(key)) out.unshift({ ...b, basePath: bp });
  }
  return out.sort((a, b) => a.port - b.port || a.title.localeCompare(b.title));
}
