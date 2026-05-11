import type { CommandExecutor } from "./command-executor.js";

const MAX_OUT = 4096;

/** True for short "what time is it here?" style questions (host clock), not "time in Paris". */
export function detectHostTimeIntent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return false;
  const t = trimmed.toLowerCase();
  if (/\bin\s+[a-z]{2,}/i.test(trimmed) && !/\b(here|local|this\s+machine|this\s+host|nova)\b/i.test(t)) {
    return false;
  }
  const timeWord =
    /\b(time|clock|hour|timestamp)\b/.test(t) ||
    /\bdate\b/.test(t) ||
    /\byear\b/.test(t) ||
    /\bday\b/.test(t) ||
    /\btimezone\b|\btz\b|\butc\b/.test(t);
  if (!timeWord) return false;
  const asks =
    /\b(what|which|current|right\s+now|now|tell|give|show)\b/.test(t) ||
    /^whats?\s+the\s+time/.test(t) ||
    /^what\s+time\b/.test(t) ||
    /\bwhat\s+year\b/.test(t) ||
    /\bwhich\s+year\b/.test(t) ||
    /^time\s*\?/.test(t);
  if (!asks && trimmed.length > 24) return false;
  return true;
}

export async function runHostTimeCollection(
  executor: CommandExecutor,
  shell: { timeoutMs: number; maxOutputBytes: number }
): Promise<string> {
  const timeoutMs = Math.min(15_000, Math.max(3_000, shell.timeoutMs));
  const maxBytes = Math.min(MAX_OUT, shell.maxOutputBytes);
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd HH:mm:ss K')"`
      : `date '+%Y-%m-%d %H:%M:%S %z' 2>/dev/null || date`;
  try {
    const result = await executor.run(cmd, [], { timeoutMs, maxOutputBytes: maxBytes });
    const out = (result.stdout || "").trim();
    const err = (result.stderr || "").trim();
    if (result.timedOut) {
      return "(timed out)";
    }
    if (result.exitCode !== 0) {
      return err || out || `(exit ${result.exitCode})`;
    }
    return out || "(empty)";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Parse shell clock output (PowerShell / GNU date) into a Date when possible. */
export function tryParseHostClockOutput(raw: string): Date | null {
  const trimmed = raw.trim().replace(/^`+|`+$/g, "");
  if (!trimmed || trimmed === "(timed out)" || trimmed === "(empty)") {
    return null;
  }
  const line = trimmed.split(/\r?\n/).find((l) => l.trim())?.trim() ?? trimmed;

  const toIso = (datePart: string, timePart: string, zone: string): string => {
    let iso = `${datePart}T${timePart}`;
    const z = zone.trim();
    if (!z) return iso;
    if (z === "Z" || z === "z") return `${iso}Z`;
    if (/^[+-]\d{4}$/.test(z)) return `${iso}${z.slice(0, 3)}:${z.slice(3)}`;
    return `${iso}${z}`;
  };

  const spaced = line.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}:\d{2})\s*([Zz]|[+-]\d{2}:\d{2}|[+-]\d{4}|[+-]\d{2}:\d{2}:\d{2})?\s*$/
  );
  if (spaced) {
    const ms = Date.parse(toIso(spaced[1], spaced[2], spaced[3] ?? ""));
    if (!Number.isNaN(ms)) return new Date(ms);
  }

  const tight = line.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2}:\d{2})([Zz]|[+-][0-9:]+)?$/);
  if (tight) {
    const ms = Date.parse(toIso(tight[1], tight[2], tight[3] ?? ""));
    if (!Number.isNaN(ms)) return new Date(ms);
  }

  const fallback = Date.parse(line.replace(" ", "T"));
  if (!Number.isNaN(fallback)) {
    return new Date(fallback);
  }
  return null;
}

/**
 * If the shell line ends with a numeric UTC offset, map it to an IANA fixed-offset
 * name so formatting matches wall time from the clock (even when Node's default TZ is UTC).
 */
function shellOffsetToDisplayTimeZone(line: string): string | undefined {
  const trimmed = line.trim();
  const withColon = trimmed.match(/\s([+-])(\d{2}):(\d{2})\s*$/);
  if (withColon) {
    const sign = withColon[1] === "+" ? 1 : -1;
    const hours = Number.parseInt(withColon[2], 10);
    const minutes = Number.parseInt(withColon[3], 10);
    if (minutes !== 0) return undefined;
    return offsetEastHoursToEtcGmt(sign * hours);
  }
  const four = trimmed.match(/\s([+-])(\d{4})\s*$/);
  if (four) {
    const sign = four[1] === "+" ? 1 : -1;
    const hours = Number.parseInt(four[2].slice(0, 2), 10);
    const minutes = Number.parseInt(four[2].slice(2), 10);
    if (minutes !== 0) return undefined;
    return offsetEastHoursToEtcGmt(sign * hours);
  }
  return undefined;
}

function offsetEastHoursToEtcGmt(eastHours: number): string {
  if (eastHours === 0) return "UTC";
  const gmtSign = eastHours > 0 ? "-" : "+";
  return `Etc/GMT${gmtSign}${Math.abs(eastHours)}`;
}

/**
 * Single-sentence local time for Nova (no “machine”, no code fences).
 * Example: `2:25 AM on Sunday, May 3, 2026.`
 */
export function formatNovaLocalTimeSentence(raw: string): string {
  const line = raw.trim().replace(/^`+|`+$/g, "").split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  const d = tryParseHostClockOutput(raw);
  if (!d || Number.isNaN(d.getTime())) {
    const t = raw.trim();
    return t ? `${t}.` : "I couldn’t read the time just now.";
  }
  const timeZone = shellOffsetToDisplayTimeZone(line);
  const timeOpts = { hour: "numeric" as const, minute: "2-digit" as const, hour12: true };
  const dateOpts = { weekday: "long" as const, month: "long" as const, day: "numeric" as const, year: "numeric" as const };
  const timeStr = timeZone
    ? d.toLocaleTimeString("en-US", { ...timeOpts, timeZone })
    : d.toLocaleTimeString("en-US", timeOpts);
  const dateStr = timeZone
    ? d.toLocaleDateString("en-US", { ...dateOpts, timeZone })
    : d.toLocaleDateString("en-US", dateOpts);
  return `${timeStr} on ${dateStr}.`;
}
