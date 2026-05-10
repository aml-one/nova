/** Nova “home” wall clock for relative phrases (default Greece). */
export function novaHomeTimeZone(): string {
  const z = process.env.NOVA_HOME_TIMEZONE?.trim();
  return z || "Europe/Athens";
}

function zonedYmd(timeZone: string, ms: number): { y: number; m: number; d: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = f.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

function zonedHm(timeZone: string, ms: number): { H: number; M: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = f.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { H: get("hour"), M: get("minute") };
}

/** Wall-clock `hour:minute` on calendar day (y,m,d) in `timeZone` → UTC ms (minute scan; DST gaps fall back to start-of-day). */
function utcMsForZonedWallClock(timeZone: string, y: number, m: number, d: number, hour: number, minute: number): number {
  let t = Date.UTC(y, m - 1, d, 0, 0, 0);
  const end = t + 36 * 3600_000;
  while (t < end) {
    const z = zonedYmd(timeZone, t);
    const hm = zonedHm(timeZone, t);
    if (z.y === y && z.m === m && z.d === d && hm.H === hour && hm.M === minute) {
      return t;
    }
    t += 60_000;
  }
  return Date.UTC(y, m - 1, d, hour, minute, 0);
}

function nextMorningInZone(timeZone: string, hour: number, minute: number): number {
  const today = zonedYmd(timeZone, Date.now());
  const anchor = new Date(Date.UTC(today.y, today.m - 1, today.d));
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + 1;
  const d = anchor.getUTCDate();
  return utcMsForZonedWallClock(timeZone, y, m, d, hour, minute);
}

export type ParsedReminderOrTimer =
  | { kind: "timer_set"; minutes: number; label: string }
  | { kind: "timer_status" }
  | { kind: "timer_cancel" }
  | { kind: "reminder_scheduled"; body: string; fireAtMs: number }
  | { kind: "reminder_timeless"; body: string }
  | { kind: "reminder_cross_scheduled"; targetToken: string; body: string; fireAtMs: number }
  | { kind: "reminder_cross_immediate"; targetToken: string; body: string }
  | { kind: "list" }
  | { kind: "dismiss_reminder"; id: string };

function normalizeReminderBody(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
}

export function parseReminderOrTimerIntent(raw: string): ParsedReminderOrTimer | undefined {
  const text = raw.trim();

  if (
    /\b(how('?s| is)\s+(the\s+)?timer|timer\s+status|time\s+left\s+on\s+(the\s+)?timer|how\s+much\s+time\s+left)\b/i.test(
      text
    ) ||
    (/\btimer\b/i.test(text) && /\b(left|remaining|status)\b/i.test(text))
  ) {
    return { kind: "timer_status" };
  }
  if (/\b(cancel|stop|clear)\s+(the\s+)?timer\b/i.test(text) || /^\/timer\s+cancel\b/i.test(text)) {
    return { kind: "timer_cancel" };
  }

  const timerMin =
    text.match(/\b(?:set\s+(?:a\s+)?|start\s+(?:a\s+)?)?timer\s+(?:for\s+)?(\d+)\s*(?:minutes?|mins?)\b/i) ??
    text.match(/\b(?:egg\s+)?timer\s+(?:for\s+)?(\d+)\s*(?:minutes?|mins?)\b/i) ??
    text.match(/\b(\d+)\s*(?:minutes?|mins?)\s+(?:egg\s+)?timer\b/i) ??
    text.match(/^\/timer\s+(\d+)\s*(?:m|min|minutes?)?\b/i);
  if (timerMin?.[1]) {
    const minutes = Math.min(24 * 60, Math.max(1, Number.parseInt(timerMin[1], 10)));
    const label = text.replace(/\s+/g, " ").slice(0, 80);
    return { kind: "timer_set", minutes, label };
  }

  const hourTimer = text.match(/\b(\d+)\s*(?:hours?|hrs?|h)\s+(?:egg\s+)?timer\b/i);
  if (hourTimer?.[1]) {
    const hours = Math.min(48, Math.max(1, Number.parseInt(hourTimer[1], 10)));
    return { kind: "timer_set", minutes: hours * 60, label: text.replace(/\s+/g, " ").slice(0, 80) };
  }

  if (
    /\b(list|show|what are)\s+(my\s+)?(reminders?|open\s+reminders?)\b/i.test(text) ||
    /\breminders?\s+list\b/i.test(text)
  ) {
    return { kind: "list" };
  }

  const dismiss = text.match(/\b(?:dismiss|done|clear|remove)\s+reminder\s+([a-f0-9-]{8,40})\b/i);
  if (dismiss?.[1]) {
    return { kind: "dismiss_reminder", id: dismiss[1] };
  }

  const crossIn =
    text.match(
      /\b(?:please\s+)?remind\s+(\S+)\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h)\b[\s.:,-]*(?:that\s+)?(.+)/is
    ) ?? text.match(/\b(?:please\s+)?remind\s+(\S+)\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h)\s+to\s+(.+)/is);
  if (crossIn?.[1] && crossIn[1].toLowerCase() !== "me" && crossIn[2] && crossIn[3] && crossIn[4]) {
    const n = Number.parseInt(crossIn[2], 10);
    const unit = crossIn[3].toLowerCase();
    const mult = unit.startsWith("h") ? 3600_000 : 60_000;
    const body = normalizeReminderBody(crossIn[4]);
    if (body) {
      return {
        kind: "reminder_cross_scheduled",
        targetToken: crossIn[1].replace(/^[@]+/, ""),
        body,
        fireAtMs: Date.now() + n * mult
      };
    }
  }

  const crossTomorrow =
    text.match(/\b(?:please\s+)?remind\s+(\S+)\s+tomorrow\b[\s.:,-]*(?:that\s+)?(?:i\s+need\s+to\s+)?(.+)/is) ??
    text.match(/\b(?:please\s+)?remind\s+(\S+)\s+tomorrow\b[\s.:,-]*to\s+(.+)/is);
  if (crossTomorrow?.[1] && crossTomorrow[1].toLowerCase() !== "me" && crossTomorrow[2]) {
    const body = normalizeReminderBody(crossTomorrow[2]);
    if (body) {
      return {
        kind: "reminder_cross_scheduled",
        targetToken: crossTomorrow[1].replace(/^[@]+/, ""),
        body,
        fireAtMs: nextMorningInZone(novaHomeTimeZone(), 9, 0)
      };
    }
  }

  const crossTo = text.match(/\b(?:please\s+)?remind\s+(\S+)\s+to\s+(.+)/is);
  if (crossTo?.[1] && crossTo[1].toLowerCase() !== "me" && crossTo[2]) {
    const body = normalizeReminderBody(crossTo[2]);
    if (body) {
      return { kind: "reminder_cross_immediate", targetToken: crossTo[1].replace(/^[@]+/, ""), body };
    }
  }

  const crossThat = text.match(/\b(?:please\s+)?remind\s+(\S+)\s+that\s+(.+)/is);
  if (crossThat?.[1] && crossThat[1].toLowerCase() !== "me" && crossThat[2]) {
    const body = normalizeReminderBody(crossThat[2]);
    if (body) {
      return { kind: "reminder_cross_immediate", targetToken: crossThat[1].replace(/^[@]+/, ""), body };
    }
  }

  const inRem =
    text.match(/\bremind\s+me\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h)\b[\s.:,-]*(.+)/is) ??
    text.match(/\bremind\s+me\s+in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h)\s+to\s+(.+)/is);
  if (inRem?.[1] && inRem?.[2] && inRem?.[3]) {
    const n = Number.parseInt(inRem[1], 10);
    const unit = inRem[2].toLowerCase();
    const mult = unit.startsWith("h") ? 3600_000 : 60_000;
    const body = normalizeReminderBody(inRem[3]);
    if (body) {
      return { kind: "reminder_scheduled", body, fireAtMs: Date.now() + n * mult };
    }
  }

  const tom =
    text.match(/\bremind\s+me\s+tomorrow\b[\s.:,-]*(?:that\s+)?(?:i\s+need\s+to\s+)?(.+)/is) ??
    text.match(/\bremind\s+me\s+tomorrow\b[\s.:,-]*to\s+(.+)/is);
  if (tom?.[1]) {
    const body = normalizeReminderBody(tom[1]);
    if (body) {
      const fireAtMs = nextMorningInZone(novaHomeTimeZone(), 9, 0);
      return { kind: "reminder_scheduled", body, fireAtMs };
    }
  }

  const timeless = text.match(/\bremind\s+me\s+(?:to|that)\s+(.+)/i);
  if (timeless?.[1] && !/\b(in|tomorrow|tonight|at\s+\d|next\s+)/i.test(text)) {
    const body = normalizeReminderBody(timeless[1]);
    if (body.length > 2) {
      return { kind: "reminder_timeless", body };
    }
  }

  return undefined;
}

export function formatTimerRemaining(endsAtMs: number, now = Date.now()): string {
  const left = Math.max(0, endsAtMs - now);
  const totalSec = Math.ceil(left / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 5) {
    return m === 1 ? "About 1 minute left." : `About ${m} minutes left.`;
  }
  if (m > 0) {
    return s > 0 ? `${m}m ${s}s left.` : `${m} minute${m === 1 ? "" : "s"} left.`;
  }
  return s > 0 ? `${s} seconds left.` : "Done now.";
}
