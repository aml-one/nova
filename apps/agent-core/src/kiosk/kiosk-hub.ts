import type { ServerResponse } from "node:http";

/** If no kiosk ping within this window, chat read-aloud falls back to the main WebUI. */
export const KIOSK_STALE_MS = 20_000;

const lastPingByUserId = new Map<string, number>();
const sseClientsByUserId = new Map<string, Set<ServerResponse>>();

export function recordKioskPing(userId: string): void {
  if (!userId) return;
  lastPingByUserId.set(userId, Date.now());
}

export function getKioskStatus(userId: string): { alive: boolean; lastPingAt: number | null } {
  const t = lastPingByUserId.get(userId) ?? null;
  if (t == null) return { alive: false, lastPingAt: null };
  return { alive: Date.now() - t < KIOSK_STALE_MS, lastPingAt: t };
}

export function broadcastKioskEvent(userId: string, event: unknown): number {
  const set = sseClientsByUserId.get(userId);
  if (!set || set.size === 0) return 0;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  let n = 0;
  const dead: ServerResponse[] = [];
  for (const res of set) {
    try {
      res.write(line);
      n += 1;
    } catch {
      dead.push(res);
    }
  }
  for (const res of dead) {
    set.delete(res);
  }
  if (set.size === 0) {
    sseClientsByUserId.delete(userId);
  }
  return n;
}

/**
 * Register an SSE client for a user. Returns detach; caller should clear keep-alives on close.
 */
export function addKioskSseClient(userId: string, res: ServerResponse): () => void {
  let set = sseClientsByUserId.get(userId);
  if (!set) {
    set = new Set();
    sseClientsByUserId.set(userId, set);
  }
  set.add(res);
  return () => {
    const s = sseClientsByUserId.get(userId);
    if (!s) return;
    s.delete(res);
    if (s.size === 0) {
      sseClientsByUserId.delete(userId);
    }
  };
}
