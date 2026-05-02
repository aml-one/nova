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
  const timeWord = /\b(time|clock|hour|timestamp)\b/.test(t) || /\bdate\b/.test(t) || /\btimezone\b|\btz\b|\butc\b/.test(t);
  if (!timeWord) return false;
  const asks =
    /\b(what|which|current|right\s+now|now|tell|give|show)\b/.test(t) ||
    /^whats?\s+the\s+time/.test(t) ||
    /^what\s+time\b/.test(t) ||
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
