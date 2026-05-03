import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";

let cache: { resolved: string; mtimeMs: number; content: string } | null = null;

export function expandUserPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("~/") || trimmed === "~") {
    return trimmed === "~" ? homedir() : `${homedir()}${trimmed.slice(1)}`;
  }
  return trimmed;
}

/** Loads SentiCore (or any) orchestration markdown from disk; capped and cached by mtime. */
export function loadSentiCoreOrchestration(pathRaw: string, maxChars = 24_000): string {
  const path = expandUserPath(pathRaw);
  if (!path) {
    return "";
  }
  try {
    const st = statSync(path);
    if (cache && cache.resolved === path && cache.mtimeMs === st.mtimeMs) {
      return cache.content;
    }
    const raw = readFileSync(path, "utf8");
    const content =
      raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n[truncated after ${maxChars} characters]` : raw;
    cache = { resolved: path, mtimeMs: st.mtimeMs, content };
    return content;
  } catch {
    return "";
  }
}
