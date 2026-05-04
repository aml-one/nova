const MAX_LINES = 500;
const lines: string[] = [];
let installed = false;

function push(line: string): void {
  const t = new Date().toISOString();
  const one = line.length > 2400 ? `${line.slice(0, 2400)}…` : line;
  lines.push(`${t} ${one}`);
  while (lines.length > MAX_LINES) {
    lines.shift();
  }
}

export function getRuntimeLogLines(): readonly string[] {
  return lines;
}

function stringifyArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack ?? a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/** Patch console + process error hooks once (agent-core process). */
export function installRuntimeConsoleCapture(): void {
  if (installed) return;
  installed = true;
  const wrap = (level: "log" | "warn" | "error" | "info") => {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        push(`[${level}] ${args.map(stringifyArg).join(" ")}`);
      } catch {
        // Ignore logging failures.
      }
      return orig(...args);
    };
  };
  wrap("log");
  wrap("warn");
  wrap("error");
  wrap("info");
  process.on("unhandledRejection", (reason) => {
    push(`[unhandledRejection] ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    push(`[uncaughtException] ${err?.stack ?? String(err)}`);
  });
}
