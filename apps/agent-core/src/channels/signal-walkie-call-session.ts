/**
 * In-memory "voice call" sessions for Signal: walkie-talkie style using voice notes + TTS replies
 * (Signal native ringing / WebRTC calls are not available through signal-cli-rest-api here).
 */

const DEFAULT_SESSION_MS = 12 * 60 * 1000;

const sessions = new Map<string, number>();

export function signalWalkiePeerKey(from: string): string {
  return from.trim().toLowerCase();
}

function sessionTtlMs(): number {
  const raw = process.env.NOVA_SIGNAL_WALKIE_SESSION_MS?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 60_000 && n <= 24 * 60 * 60_000) {
      return Math.floor(n);
    }
  }
  return DEFAULT_SESSION_MS;
}

export function signalWalkieCallStart(peer: string): void {
  sessions.set(signalWalkiePeerKey(peer), Date.now() + sessionTtlMs());
}

export function signalWalkieCallEnd(peer: string): void {
  sessions.delete(signalWalkiePeerKey(peer));
}

/** Extend TTL when the user sends another message while a session is active. */
export function signalWalkieCallRefresh(peer: string): boolean {
  const k = signalWalkiePeerKey(peer);
  const exp = sessions.get(k);
  if (!exp || exp <= Date.now()) {
    sessions.delete(k);
    return false;
  }
  sessions.set(k, Date.now() + sessionTtlMs());
  return true;
}

export function signalWalkieCallIsActive(peer: string): boolean {
  const k = signalWalkiePeerKey(peer);
  const exp = sessions.get(k);
  if (!exp || exp <= Date.now()) {
    sessions.delete(k);
    return false;
  }
  return true;
}

/** Greeting sent when the user opens a walkie session with `/call` (voice TTS uses the same string). */
export const SIGNAL_WALKIE_GREETING = "Hey, it's Nova! What's up?";

export function isSignalHangupCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t === "/hangup" || t === "/endcall" || t === "/bye" || t === "/end") return true;
  return /^(end(\s+the)?\s+call|hang\s*up)\b/i.test(text.trim());
}

/**
 * `/call`, `/voice`, `/walkie`, or `/call …` with optional remainder text handled in the same turn.
 */
export function parseSignalWalkieCallCommand(text: string): { remainder: string } | null {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const solo = new Set(["/call", "/voice", "/walkie"]);
  if (solo.has(lower)) {
    return { remainder: "" };
  }
  const prefixes = ["/call ", "/voice ", "/walkie "];
  for (const p of prefixes) {
    if (lower.startsWith(p)) {
      return { remainder: raw.slice(p.length).trim() };
    }
  }
  if (/^(hey\s+)?nova,?\s+((start|open)\s+)?(a\s+)?(voice\s+)?call\s*$/i.test(raw)) {
    return { remainder: "" };
  }
  if (/^start\s+(a\s+)?(voice\s+)?call\s*$/i.test(lower)) {
    return { remainder: "" };
  }
  return null;
}

export type NaturalCallMeIntent =
  | { kind: "immediate" }
  | { kind: "in_ms"; delayMs: number; label: string }
  | { kind: "at"; whenMs: number; label: string };

function stripLeadingNovaCallPrefix(lower: string): string {
  return lower.replace(/^hey\s+nova,?\s+/i, "").replace(/^nova,?\s+/i, "");
}

function clockTo24h(hour12or24: number, minute: number, mer?: string): { h: number; m: number } {
  let h = hour12or24;
  const m = Number.isFinite(minute) ? Math.min(59, Math.max(0, Math.floor(minute))) : 0;
  const merNorm = (mer ?? "").toLowerCase().replace(/\./g, "").trim();
  if (merNorm.startsWith("p")) {
    if (h < 12) h += 12;
  } else if (merNorm.startsWith("a")) {
    if (h === 12) h = 0;
  } else {
    if (h >= 1 && h <= 11) {
      h += 12;
    }
  }
  if (h < 0 || h > 23) h = Math.min(23, Math.max(0, h));
  return { h, m };
}

function atLocalNextDay(hour: number, minute: number, mer?: string): number {
  const { h, m } = clockTo24h(hour, minute, mer);
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function atLocalToday(hour: number, minute: number, mer?: string): number {
  const { h, m } = clockTo24h(hour, minute, mer);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

/**
 * Natural phrases: "call me", "call me in 20 minutes", "call me tomorrow 3pm", "call me today at 3:30 pm".
 * Not a real PSTN call — schedules or starts the Signal walkie (voice-note) session.
 */
export function parseNaturalLanguageCallMe(text: string): NaturalCallMeIntent | null {
  const raw = text.trim();
  if (!raw) return null;
  const s = stripLeadingNovaCallPrefix(raw.toLowerCase());

  const inMatch = s.match(
    /^call\s+me\s+in\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|second|seconds|sec|secs)s?\s*\.?\s*$/i
  );
  if (inMatch) {
    const n = Math.max(1, parseInt(inMatch[1]!, 10));
    const unit = inMatch[2]!.toLowerCase();
    let delayMs = n * 60_000;
    if (unit.startsWith("hour") || unit === "hr" || unit === "hrs") delayMs = n * 3600_000;
    if (unit.startsWith("sec")) delayMs = n * 1000;
    const label =
      unit.startsWith("hour") || unit === "hr" || unit === "hrs"
        ? `in ${n} hour${n === 1 ? "" : "s"}`
        : unit.startsWith("sec")
          ? `in ${n} second${n === 1 ? "" : "s"}`
          : `in ${n} minute${n === 1 ? "" : "s"}`;
    return { kind: "in_ms", delayMs, label };
  }

  const tomMatch = s.match(
    /^call\s+me\s+(tomorrow|tmrw)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*\.?\s*$/i
  );
  if (tomMatch) {
    const hour = parseInt(tomMatch[2]!, 10);
    const minute = tomMatch[3] ? parseInt(tomMatch[3], 10) : 0;
    const mer = tomMatch[4];
    const whenMs = atLocalNextDay(hour, minute, mer);
    return {
      kind: "at",
      whenMs,
      label: `tomorrow ${hour}:${String(minute).padStart(2, "0")}${mer ? ` ${mer}` : ""}`
    };
  }

  const todayMatch = s.match(
    /^call\s+me\s+(?:today\s+)?at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*\.?\s*$/i
  );
  if (todayMatch) {
    const hour = parseInt(todayMatch[1]!, 10);
    const minute = todayMatch[2] ? parseInt(todayMatch[2], 10) : 0;
    const mer = todayMatch[3];
    const whenMs = atLocalToday(hour, minute, mer);
    return { kind: "at", whenMs, label: `today at ${hour}:${String(minute).padStart(2, "0")}${mer ? ` ${mer}` : ""}` };
  }

  if (/^call\s+me(\s+now)?\s*[.!]?$/i.test(s) || /^ring\s+me(\s+now)?\s*[.!]?$/i.test(s)) {
    return { kind: "immediate" };
  }

  return null;
}
