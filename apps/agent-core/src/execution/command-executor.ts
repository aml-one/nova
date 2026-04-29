import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type CommandRunOptions = {
  timeoutMs?: number;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
  cwd?: string;
  maxOutputBytes?: number;
};

export class CommandExecutor {
  constructor(private readonly getAllowedCwds: () => string[] = () => [resolvePath(process.cwd())]) {}

  async run(
    command: string,
    args: string[] = [],
    options: CommandRunOptions = {}
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const allowedCwds = this.getAllowedCwds().map((entry) => resolvePath(entry));
      const fallbackCwd = allowedCwds[0] ?? resolvePath(process.cwd());
      const requestedCwd = options.cwd ? resolvePath(options.cwd) : fallbackCwd;
      if (!allowedCwds.some((allowed) => requestedCwd.startsWith(allowed))) {
        reject(new Error("command cwd is outside delegated folders"));
        return;
      }
      const containerWrapper = process.env.NOVA_SHELL_CONTAINER_COMMAND;
      const commandLine = [command, ...args].join(" ");
      const finalCommand = containerWrapper ? `${containerWrapper} "${commandLine.replace(/"/g, '\\"')}"` : commandLine;
      const child = spawn(finalCommand, { shell: true, cwd: requestedCwd });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeoutMs = options.timeoutMs ?? 30000;
      const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout?.on("data", (chunk: Buffer | string) => {
        const text = String(chunk);
        if (Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(text, "utf8") <= maxOutputBytes) {
          stdout += text;
        }
        options.onStdoutChunk?.(text);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        const text = String(chunk);
        if (Buffer.byteLength(stderr, "utf8") + Buffer.byteLength(text, "utf8") <= maxOutputBytes) {
          stderr += text;
        }
        options.onStderrChunk?.(text);
      });
      child.on("error", (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
      });
    });
  }
}
