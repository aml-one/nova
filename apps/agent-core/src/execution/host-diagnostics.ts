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
  const summary = await collectUsageSummary(executor, {
    timeoutMs: perSnippet,
    wantCpu,
    wantMem,
    wantGpu
  });
  if (summary) {
    parts.push(summary);
  }

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

async function collectUsageSummary(
  executor: CommandExecutor,
  input: { timeoutMs: number; wantCpu: boolean; wantMem: boolean; wantGpu: boolean }
): Promise<string | null> {
  const bits: string[] = [];
  const p = process.platform;
  if (input.wantCpu) {
    const cpu = await readCpuPercent(executor, input.timeoutMs, p);
    if (cpu !== null) bits.push(`CPU ${cpu.toFixed(1)}%`);
  }
  if (input.wantMem) {
    const mem = await readMemoryUsage(executor, input.timeoutMs, p);
    if (mem) bits.push(`RAM ${formatBinary(mem.usedBytes)}/${formatBinary(mem.totalBytes)}`);
  }
  if (input.wantGpu) {
    const gpu = await readGpuPercent(executor, input.timeoutMs, p);
    bits.push(`GPU ${gpu !== null ? `${Math.round(gpu)}%` : "n/a"}`);
  }
  if (!bits.length) return null;
  return `Summary: ${bits.join(", ")}\n`;
}

async function readCpuPercent(executor: CommandExecutor, timeoutMs: number, platform: NodeJS.Platform): Promise<number | null> {
  const command =
    platform === "win32"
      ? "powershell -NoProfile -Command \"(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue\""
      : platform === "darwin"
        ? "sh -c \"top -l 1 -n 0 | awk -F'[:,%]' '/CPU usage/{idle=$(NF-1); gsub(/ /,\\\"\\\",idle); print 100-idle; exit}'\""
        : "sh -c \"top -bn1 | awk -F',' '/Cpu\\(s\\)/{for(i=1;i<=NF;i++){if($i~/%id/){x=$i; gsub(/[^0-9.]/,\\\"\\\",x); print 100-x; exit}}}'\"";
  try {
    const out = await executor.run(command, [], { timeoutMs, maxOutputBytes: 4096 });
    const text = `${out.stdout}\n${out.stderr}`;
    const match = text.match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  } catch {
    return null;
  }
}

async function readMemoryUsage(
  executor: CommandExecutor,
  timeoutMs: number,
  platform: NodeJS.Platform
): Promise<{ usedBytes: number; totalBytes: number } | null> {
  try {
    if (platform === "win32") {
      const out = await executor.run(
        "powershell -NoProfile -Command \"$os=Get-CimInstance Win32_OperatingSystem; $t=[double]$os.TotalVisibleMemorySize*1024; $f=[double]$os.FreePhysicalMemory*1024; Write-Output ($t.ToString()+','+($t-$f).ToString())\"",
        [],
        { timeoutMs, maxOutputBytes: 4096 }
      );
      const m = out.stdout.match(/(\d+)\s*,\s*(\d+)/);
      if (!m) return null;
      const total = Number(m[1]);
      const used = Number(m[2]);
      if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) return null;
      return { usedBytes: Math.max(0, used), totalBytes: total };
    }
    if (platform === "darwin") {
      const totalOut = await executor.run("sysctl -n hw.memsize", [], { timeoutMs, maxOutputBytes: 4096 });
      const totalMatch = totalOut.stdout.match(/(\d+)/);
      if (!totalMatch) return null;
      const total = Number(totalMatch[1]);
      const vm = await executor.run("vm_stat", [], { timeoutMs, maxOutputBytes: 16 * 1024 });
      const pageSizeMatch = vm.stdout.match(/page size of\s+(\d+)\s+bytes/i);
      const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;
      const active = extractVmPages(vm.stdout, "Pages active");
      const wired = extractVmPages(vm.stdout, "Pages wired down");
      const compressor = extractVmPages(vm.stdout, "Pages occupied by compressor");
      const usedPages = active + wired + compressor;
      const used = usedPages > 0 ? usedPages * pageSize : Math.max(0, total - extractVmPages(vm.stdout, "Pages free") * pageSize);
      if (!Number.isFinite(total) || total <= 0) return null;
      return { usedBytes: Math.max(0, used), totalBytes: total };
    }
    const out = await executor.run("free -b 2>/dev/null || free", [], { timeoutMs, maxOutputBytes: 8192 });
    const line = out.stdout
      .split(/\r?\n/)
      .find((row) => row.trim().toLowerCase().startsWith("mem:"));
    if (!line) return null;
    const nums = line.match(/\d+/g)?.map((n) => Number(n)) ?? [];
    if (nums.length < 3 || !Number.isFinite(nums[0]) || nums[0] <= 0) return null;
    const total = nums[0];
    const used = nums[1];
    return { usedBytes: Math.max(0, used), totalBytes: total };
  } catch {
    return null;
  }
}

function extractVmPages(text: string, label: string): number {
  const re = new RegExp(`${label}:\\s*(\\d+)\\.?`, "i");
  const m = text.match(re);
  return m ? Number(m[1]) : 0;
}

async function readGpuPercent(executor: CommandExecutor, timeoutMs: number, _platform: NodeJS.Platform): Promise<number | null> {
  try {
    const out = await executor.run(
      "nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -n 1",
      [],
      { timeoutMs, maxOutputBytes: 4096 }
    );
    const match = `${out.stdout}\n${out.stderr}`.match(/(\d+(\.\d+)?)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  } catch {
    return null;
  }
}

function formatBinary(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const precision = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)}${units[idx]}`;
}

/** True when the user is asking for real disk / volume free space on the Nova host (not trivia about the word "space"). */
export function detectHostDiskSpaceIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length === 0 || t.length > 4000) return false;
  if (/\bdf\s*-?h?\b/.test(t)) return true;
  if (/\bhow\s+much\b/.test(t) && /\b(space|disk|storage)\b/.test(t) && /\b(free|left|available)\b/.test(t)) return true;
  if (/\b(free|available|left)\b/.test(t) && /\b(space|disk|storage|drive|volume)\b/.test(t)) return true;
  if (/\b(disk|storage|drive|volume|filesystem)\b/.test(t) && /\b(free|available|usage|capacity|full|empty)\b/.test(t)) {
    return true;
  }
  if (/\bon\s+your\s+(computer|machine|host|pc|laptop|system)\b/.test(t) && /\b(space|disk|storage|free|drive)\b/.test(t)) {
    return true;
  }
  if (/\bhard\s+drive\b|\bhd\b|\bssd\b|\bmount(ed)?\s+point\b/.test(t) && /\b(free|space|usage)\b/.test(t)) {
    return true;
  }
  return false;
}

export async function runHostDiskSpaceCollection(
  executor: CommandExecutor,
  shell: { timeoutMs: number; maxOutputBytes: number }
): Promise<string> {
  const timeoutMs = Math.min(30_000, Math.max(5000, shell.timeoutMs));
  const maxBytes = shell.maxOutputBytes;
  const platform = process.platform;
  if (platform === "win32") {
    return await runSnippet(
      executor,
      "Disk (Win32)",
      "powershell -NoProfile -Command \"Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,FreeSpace,Size | Format-Table -AutoSize | Out-String -Width 200\"",
      timeoutMs,
      maxBytes
    );
  }
  return await runSnippet(executor, "Disk (df -h)", "df -h", timeoutMs, maxBytes);
}

function stripDiskRunLabel(body: string): string {
  return body.replace(/^Disk \(df -h\):\s*/i, "").replace(/^Disk \(Win32\):\s*/i, "").trim();
}

function normalizeDfAvailForProse(avail: string): string {
  const m = avail.match(/^(\d+(?:\.\d+)?)(Gi|Ti|Mi|Ki|Pi|Ei|G|T|M|K|B)$/i);
  if (!m) return avail;
  const n = m[1];
  const u = m[2];
  if (/^Gi$/i.test(u)) return `${n} GiB`;
  if (/^Ti$/i.test(u)) return `${n} TiB`;
  if (/^Mi$/i.test(u)) return `${n} MiB`;
  if (/^Ki$/i.test(u)) return `${n} KiB`;
  if (/^Pi$/i.test(u)) return `${n} PiB`;
  if (/^Ei$/i.test(u)) return `${n} EiB`;
  if (/^G$/i.test(u)) return `${n} GB`;
  if (/^T$/i.test(u)) return `${n} TB`;
  if (/^M$/i.test(u)) return `${n} MB`;
  if (/^K$/i.test(u)) return `${n} KB`;
  if (/^B$/i.test(u)) return `${n} B`;
  return avail;
}

function parseDfDataLine(line: string): { mount: string; avail: string } | null {
  const trimmed = line.trim();
  if (!trimmed || /^Filesystem\s/i.test(trimmed)) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 6) return null;
  const mount = parts[parts.length - 1];
  if (!mount.startsWith("/")) return null;
  const size = parts[1];
  const avail = parts[3];
  if (!/^\d/.test(size) || !/^\d/.test(avail)) return null;
  return { mount, avail };
}

function summarizeDfHuman(dfText: string): string | null {
  const rows: { mount: string; avail: string }[] = [];
  for (const line of dfText.split("\n")) {
    const p = parseDfDataLine(line);
    if (p) rows.push(p);
  }
  if (rows.length === 0) return null;

  const root = rows.find((r) => r.mount === "/");
  const data = rows.find((r) => r.mount === "/System/Volumes/Data");
  const parts: string[] = [];

  if (root && data && root.avail === data.avail) {
    parts.push(
      `About **${normalizeDfAvailForProse(root.avail)}** free on \`/\` and \`/System/Volumes/Data\` (shared free space on this APFS volume group).`
    );
  } else {
    if (root) {
      parts.push(`About **${normalizeDfAvailForProse(root.avail)}** free on \`/\`.`);
    }
    if (data && (!root || data.avail !== root.avail)) {
      parts.push(`About **${normalizeDfAvailForProse(data.avail)}** free on \`/System/Volumes/Data\`.`);
    }
  }

  if (parts.length > 0) {
    return `${parts.join(" ")} Raw \`df -h\` output is in the block below.`;
  }

  const boring = /^\/(dev|run|proc|sys)(\/|$)/;
  const interesting = rows.filter((r) => !boring.test(r.mount));
  const pick = interesting[0] ?? rows[0];
  return `About **${normalizeDfAvailForProse(pick.avail)}** free on \`${pick.mount}\`. Raw \`df -h\` output is in the block below.`;
}

function summarizeWin32Disk(text: string): string | null {
  const drives: { id: string; free: number }[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const m = trimmed.match(/^([A-Z]):\s+(\d+)\s+(\d+)\s*$/i);
    if (m) {
      drives.push({ id: `${m[1].toUpperCase()}:`, free: Number(m[2]) });
    }
  }
  if (drives.length === 0) return null;
  const bits = drives.map((d) => `**${formatBinary(d.free)}** free on **${d.id}**`);
  return `${bits.join(" ")} Full WMI output is in the block below.`;
}

export function formatHostDiskSpaceReply(raw: string): string {
  const body = raw.trim();
  const stripped = stripDiskRunLabel(body);
  const failed = /^\(exit /m.test(stripped) || /^\(error:/m.test(stripped);
  let summary: string | null = null;
  if (!failed && stripped.length > 0) {
    summary = /^Disk \(Win32\):/i.test(body) ? summarizeWin32Disk(stripped) : summarizeDfHuman(stripped);
  }
  const code = `\`\`\`text\n${body}\n\`\`\``;
  return summary ? `${summary}\n\n${code}` : code;
}
