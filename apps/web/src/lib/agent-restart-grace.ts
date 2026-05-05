const STORAGE_KEY = "nova-expect-agent-restart";
const TTL_MS = 15 * 60 * 1000;

export function markAgentRestartExpected(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, `${Date.now()}`);
}

export function clearAgentRestartExpected(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * True shortly after the user applied an update (or similar), when the agent may be down on purpose.
 * Expired entries are removed.
 */
export function isAgentRestartGraceActive(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  const t = Number(raw);
  if (!Number.isFinite(t) || Date.now() - t > TTL_MS) {
    sessionStorage.removeItem(STORAGE_KEY);
    return false;
  }
  return true;
}
