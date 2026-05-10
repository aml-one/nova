/**
 * Orpheus-FastAPI is mounted at the server root; Nova calls `POST {base}/v1/audio/speech`.
 * Users often paste OpenWebUI-style `http://host:5005/v1` — that would become `/v1/v1/audio/speech` without normalization.
 */
export function normalizeOrpheusBaseUrl(raw: string): string {
  let b = raw.trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(b)) {
    b = b.replace(/\/v1$/i, "").replace(/\/+$/, "");
  }
  return b;
}

/** Avoid `Authorization: Bearer Bearer sk-…` when the UI stores a full Bearer value. */
export function formatOrpheusAuthorizationHeader(apiKey: string): string | undefined {
  const t = apiKey.trim();
  if (!t) {
    return undefined;
  }
  if (/^bearer\s+/i.test(t)) {
    const token = t.replace(/^bearer\s+/i, "").trim();
    return token ? `Bearer ${token}` : undefined;
  }
  return `Bearer ${t}`;
}
