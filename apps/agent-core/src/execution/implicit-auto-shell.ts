import type { CommandExecutor } from "./command-executor.js";
import { detectHostDiskSpaceIntent, detectHostDiagnosticsIntent } from "./host-diagnostics.js";
import { detectHostTimeIntent } from "./host-time.js";
import { detectOllamaInventoryIntent } from "./ollama-inventory.js";

export type ImplicitShellPlan = { command: string; reason: string };

/** Commands Nova may run without an explicit `/run` (exact match after trim). */
const ALLOWED_IMPLICIT_COMMANDS = new Set([
  "git status",
  "git log -n 5 --oneline",
  "pwd",
  "date",
  "uname -a",
  "hostname",
  "cmd /c ver",
  "python --version",
  "python3 --version",
  "node --version"
]);

export function implicitShellAutoEnabled(): boolean {
  const raw = process.env.NOVA_IMPLICIT_SHELL?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
}

export function planImplicitReadOnlyShell(text: string): ImplicitShellPlan | null {
  if (!implicitShellAutoEnabled()) return null;
  const trimmed = text.trim();
  if (trimmed.length < 6 || trimmed.length > 4000) return null;
  if (trimmed.startsWith("/")) return null;

  if (detectHostDiskSpaceIntent(text)) return null;
  if (detectHostDiagnosticsIntent(text)) return null;
  if (detectHostTimeIntent(text)) return null;
  if (detectOllamaInventoryIntent(text)) return null;

  const t = trimmed.toLowerCase();

  if (
    /\b(git\s+status|status\s+of\s+(the\s+)?repo|repo\s+status|uncommitted|dirty\s+working|what\s+changed\s+in\s+git)\b/i.test(
      trimmed
    ) &&
    /\b(git|repo|commit|branch|staged|untracked)\b/.test(t)
  ) {
    return { command: "git status", reason: "git_status" };
  }
  if (/\b(recent\s+commits?|last\s+few\s+commits?|git\s+log|commit\s+history)\b/i.test(trimmed) && /\b(git|commit)\b/.test(t)) {
    return { command: "git log -n 5 --oneline", reason: "git_log_short" };
  }
  if (/\b(pwd|current\s+working\s+directory|cwd|where\s+am\s+i\s+on\s+disk)\b/i.test(t)) {
    return { command: "pwd", reason: "pwd" };
  }
  if (/\b(hostname|host\s+name)\b/i.test(trimmed) && /\b(you|nova|this\s+machine|this\s+host|system|server)\b/.test(t)) {
    return { command: "hostname", reason: "hostname" };
  }
  if (
    /\b(os\s+version|kernel|uname|what\s+os|operating\s+system|platform)\b/i.test(trimmed) &&
    /\b(you|nova|this\s+machine|this\s+host|system|server|computer)\b/.test(t)
  ) {
    return process.platform === "win32"
      ? { command: "cmd /c ver", reason: "os_version_win" }
      : { command: "uname -a", reason: "os_version_unix" };
  }
  if (/\b(what\s+)?(date|day)\s+(is\s+it|today)\b/i.test(t) && /\b(here|local|this\s+machine|nova|host)\b/.test(t)) {
    return { command: "date", reason: "host_date" };
  }
  if (/\bpython\s+version\b|\bwhat\s+python\b/i.test(trimmed)) {
    return process.platform === "win32"
      ? { command: "python --version", reason: "python_version" }
      : { command: "python3 --version", reason: "python_version" };
  }
  if (/\bnode\s+version\b|\bwhat\s+node\b/i.test(trimmed)) {
    return { command: "node --version", reason: "node_version" };
  }

  return null;
}

const MAX_IMPLICIT_APPEND = 10_000;

export async function runImplicitShellPlan(
  executor: CommandExecutor,
  plan: ImplicitShellPlan,
  shell: { timeoutMs: number; maxOutputBytes: number }
): Promise<string> {
  const cmd = plan.command.trim();
  if (!ALLOWED_IMPLICIT_COMMANDS.has(cmd)) {
    return "";
  }
  const timeoutMs = Math.min(25_000, Math.max(4000, shell.timeoutMs));
  const maxBytes = Math.min(MAX_IMPLICIT_APPEND, Math.max(4096, shell.maxOutputBytes));
  try {
    const result = await executor.run(cmd, [], { timeoutMs, maxOutputBytes: maxBytes });
    const stdout = (result.stdout || "").trimEnd();
    const stderr = (result.stderr || "").trimEnd();
    const bits = [`$ ${cmd}`, result.timedOut ? "(timed out)" : `exit ${result.exitCode}`];
    if (stdout) bits.push(stdout);
    if (stderr) bits.push(stderr ? `stderr:\n${stderr}` : "");
    let block = bits.filter(Boolean).join("\n");
    if (block.length > MAX_IMPLICIT_APPEND) {
      block = `${block.slice(0, MAX_IMPLICIT_APPEND)}\n[truncated]`;
    }
    return block;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `$ ${cmd}\n(error: ${msg})`;
  }
}
