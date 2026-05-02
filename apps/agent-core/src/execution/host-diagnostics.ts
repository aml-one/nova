import type { CommandExecutor } from "./command-executor.js";

export type HostDiagnosticsScope = "cpu" | "memory" | "gpu" | "full";

const MAX_SNIPPET_BYTES = 48 * 1024;

export function detectHostDiagnosticsIntent(text: string): HostDiagnosticsScope | null {
  const trimmed = text.trim();
  if (trimmed.length > 12_000) {
    return null;
  }
  if (/^(what is|what are|define|explain)\s+(a\s+)?(cpu|gpu|ram|processor|graphics)\b/i.test(trimmed)) {
    return null;
  }

  const t = trimmed.toLowerCase();
  const hwCpu = /\b(cpu|processors?|cores?|clock speed)\b/.test(t);
  const hwMem = /\b(ram|memory|mem(ory)?\s+usage|system memory)\b/.test(t);
  const hwGpu = /\b(\bgpu\b|vram|nvidia|graphics\s+card|video\s+card|display\s+adapter)\b/.test(t);
  const hostCtx = /\b(this\s+)?(pc|computer|machine|host|system|laptop|desktop)\b/.test(t);
  const ask =
    /\b(check|what|how\s+(much|many|is)|usage|utili[sz]ation|load|metrics|stats|info|status|monitor|tell\s+me|can\s+you|could\s+you|please|show|read)\b/.test(
      t
    ) || /\b(my|your)\b/.test(t);
  const broadUsage =
    /\b(resource|hardware)\s+usage\b/i.test(trimmed) || /\b(system|host)\s+(resource|metrics|stats)\b/i.test(trimmed);

  if (!(ask || hostCtx) || !(hwCpu || hwMem || hwGpu)) {
    if (!broadUsage) {
      return null;
    }
    return "full";
  }

  if (hwGpu && !hwCpu && !hwMem) {
    return "gpu";
  }
  if (hwMem && !hwCpu && !hwGpu) {
    return "memory";
  }
  if (hwCpu && !hwMem && !hwGpu) {
    return "cpu";
  }
  if (hwCpu || hwMem || hwGpu || hostCtx) {
    return "full";
  }
  return null;
}

export function implicitHostDiagnosticsShellAllowed(accessProfile?: {
  capabilities: { shellAccess: boolean };
}): boolean {
  if (!accessProfile) {
    return true;
  }
  return accessProfile.capabilities.shellAccess;
}

async function runSnippet(
  executor: CommandExecutor,
  label: string,
  command: string,
  timeoutMs: number,
  maxOutputBytes: number
): Promise<string> {
  try {
    const result = await executor.run(command, [], {
      timeoutMs,
      maxOutputBytes: Math.min(maxOutputBytes, MAX_SNIPPET_BYTES)
    });
    const out = (result.stdout || "").trim();
    const err = (result.stderr || "").trim();
    const ok = result.exitCode === 0 && !result.timedOut;
    if (!ok) {
      return `${label}:\n(exit ${result.exitCode}, timedOut=${result.timedOut})\n${err || out || "(no output)"}\n`;
    }
    return `${label}:\n${out || "(empty)"}\n`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${label}:\n(error: ${message})\n`;
  }
}

export async function runHostDiagnosticsCollection(
  executor: CommandExecutor,
  scope: HostDiagnosticsScope,
  shell: { timeoutMs: number; maxOutputBytes: number }
): Promise<string> {
  const perSnippet = Math.min(20_000, Math.max(5_000, shell.timeoutMs));
  const maxBytes = shell.maxOutputBytes;
  const platform = process.platform;
  const parts: string[] = [];

  const wantCpu = scope === "cpu" || scope === "full";
  const wantMem = scope === "memory" || scope === "full";
  const wantGpu = scope === "gpu" || scope === "full";

  if (platform === "win32") {
    if (wantCpu) {
      parts.push(
        await runSnippet(
          executor,
          "CPU (Win32)",
          'powershell -NoProfile -Command "(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | Format-List | Out-String).Trim()"',
          perSnippet,
          maxBytes
        )
      );
    }
    if (wantMem) {
      parts.push(
        await runSnippet(
          executor,
          "Memory (Win32)",
          "powershell -NoProfile -Command \"Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | Format-List | Out-String -Width 200\"",
          perSnippet,
          maxBytes
        )
      );
    }
    if (wantGpu) {
      const nvidia = await runSnippet(executor, "GPU (nvidia-smi)", "nvidia-smi -L 2>nul", perSnippet, maxBytes);
      parts.push(nvidia);
      if (/\(exit /i.test(nvidia) || /\(error:/i.test(nvidia)) {
        parts.push(
          await runSnippet(
            executor,
            "GPU (WMI)",
            "wmic path win32_VideoController get Name,AdapterRAM /format:list 2>nul",
            perSnippet,
            maxBytes
          )
        );
      }
    }
  } else if (platform === "darwin") {
    if (wantCpu) {
      parts.push(
        await runSnippet(
          executor,
          "CPU (Darwin)",
          'sh -c "echo brand:; sysctl -n machdep.cpu.brand_string 2>/dev/null; echo ncpu:; sysctl -n hw.ncpu 2>/dev/null"',
          perSnippet,
          maxBytes
        )
      );
    }
    if (wantMem) {
      parts.push(
        await runSnippet(
          executor,
          "Memory (Darwin)",
          'sh -c "sysctl hw.memsize hw.physicalcpu 2>/dev/null; vm_stat | head -n 15"',
          perSnippet,
          maxBytes
        )
      );
    }
    if (wantGpu) {
      parts.push(
        await runSnippet(
          executor,
          "GPU (Darwin)",
          "system_profiler SPDisplaysDataType 2>/dev/null | head -n 60",
          perSnippet,
          maxBytes
        )
      );
    }
  } else {
    if (wantCpu) {
      parts.push(
        await runSnippet(
          executor,
          "CPU (Unix)",
          'sh -c "echo ---nproc---; nproc 2>/dev/null; echo ---model---; cat /proc/cpuinfo 2>/dev/null | head -n 40"',
          perSnippet,
          maxBytes
        )
      );
    }
    if (wantMem) {
      parts.push(await runSnippet(executor, "Memory (Unix)", "free -h 2>/dev/null || free 2>/dev/null", perSnippet, maxBytes));
    }
    if (wantGpu) {
      parts.push(
        await runSnippet(
          executor,
          "GPU (nvidia-smi)",
          "nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu --format=csv 2>/dev/null || nvidia-smi 2>/dev/null | head -n 25",
          perSnippet,
          maxBytes
        )
      );
    }
  }

  const combined = parts.join("\n").trim();
  return combined;
}
