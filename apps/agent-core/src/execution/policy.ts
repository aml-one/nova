const denyPatterns = [
  /\brm\s+-rf\s+\/?$/i,
  /\brm\s+-rf\s+[~/$]/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs(\.[a-z0-9]+)?\b/i,
  /\bdel\s+\/f\s+\/s\s+\/q\b/i,
  /\bchmod\s+-R\s+777\s+\//i
];

const allowedPrefixes = ["echo", "dir", "ls", "pwd", "date", "git status", "git log", "node", "python", "ffmpeg"];

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
  riskLevel: "low" | "medium" | "high";
};

export function evaluateCommandPolicy(command: string): PolicyDecision {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allowed: false, reason: "empty command", riskLevel: "low" };
  }
  if (denyPatterns.some((pattern) => pattern.test(trimmed))) {
    return { allowed: false, reason: "matched deny pattern", riskLevel: "high" };
  }
  const riskLevel = inferRiskLevel(trimmed);
  if (process.env.NOVA_SHELL_FULL_AUTO === "true") {
    return { allowed: true, reason: "full auto enabled", riskLevel };
  }
  const isAllowlisted = allowedPrefixes.some((prefix) => trimmed.toLowerCase().startsWith(prefix));
  if (!isAllowlisted) {
    return {
      allowed: false,
      reason: "command not in allowlist (set NOVA_SHELL_FULL_AUTO=true to override)",
      riskLevel
    };
  }
  return { allowed: true, reason: "allowlisted command", riskLevel };
}

function inferRiskLevel(command: string): "low" | "medium" | "high" {
  if (/\bgit\s+(push|rebase|reset|checkout)\b/i.test(command)) {
    return "high";
  }
  if (/\b(npm|pnpm|pip)\s+install\b/i.test(command)) {
    return "medium";
  }
  return "low";
}
