import type { RuntimeSkill } from "@nova/skills";
import { spawnSync } from "node:child_process";

type SkillInput = {
  mode?: "monitor" | "detect" | "block_ip" | "harden";
  thresholdPerIp?: number;
  ipToBlock?: string;
  allowlistPorts?: number[];
  apply?: boolean;
  confirmation?: string;
};

type Connection = {
  protocol: "tcp" | "udp";
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state?: string;
};

type Anomaly = {
  type: "high-volume-remote-ip" | "port-scan-pattern" | "risky-listening-port";
  severity: "low" | "medium" | "high";
  detail: string;
};

const RISKY_PORTS = new Set([21, 23, 445, 3389, 5900]);
const ACTION_CONFIRMATION = "I_ACKNOWLEDGE_NETWORK_CHANGES";

export const networkDefenseSkill: RuntimeSkill = {
  manifest: {
    id: "network-defense",
    name: "Network Defense",
    description:
      "Monitor host network traffic, detect anomalies, propose mitigations, and (with explicit confirmation) apply firewall blocks/hardening.",
    permissions: ["network", "shell"],
    inputSchema: {
      type: "object",
      additionalProperties: false
    },
    version: "0.1.0"
  },
  async run(input: unknown): Promise<unknown> {
    const parsed = normalizeInput(input);
    const snapshot = collectConnections();
    const anomalies = detectAnomalies(snapshot, parsed.thresholdPerIp);
    const recommendations = buildRecommendations(snapshot, anomalies);

    if (parsed.mode === "block_ip") {
      if (!parsed.ipToBlock) {
        throw new Error("ipToBlock is required for block_ip mode");
      }
      const result = applyBlockIp(parsed.ipToBlock, parsed.apply, parsed.confirmation);
      return { mode: parsed.mode, anomalies, recommendations, action: result };
    }

    if (parsed.mode === "harden") {
      const result = hardenHost(snapshot, parsed.allowlistPorts, parsed.apply, parsed.confirmation);
      return { mode: parsed.mode, anomalies, recommendations, action: result };
    }

    return {
      mode: parsed.mode,
      summary: summarizeSnapshot(snapshot),
      anomalies,
      recommendations
    };
  }
};

function normalizeInput(input: unknown): Required<Omit<SkillInput, "ipToBlock" | "allowlistPorts">> &
  Pick<SkillInput, "ipToBlock" | "allowlistPorts"> {
  const parsed = (input ?? {}) as SkillInput;
  return {
    mode: parsed.mode ?? "detect",
    thresholdPerIp: Number(parsed.thresholdPerIp ?? 40),
    apply: parsed.apply === true,
    confirmation: parsed.confirmation ?? "",
    ipToBlock: parsed.ipToBlock?.trim(),
    allowlistPorts: Array.isArray(parsed.allowlistPorts)
      ? parsed.allowlistPorts.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0 && item < 65536)
      : []
  };
}

function collectConnections(): Connection[] {
  const command = process.platform === "win32" ? "netstat -ano" : "netstat -an";
  const result = run(command);
  if (!result.ok) {
    throw new Error(`failed to inspect network state: ${result.stderr || result.stdout}`);
  }
  return parseConnections(result.stdout);
}

function parseConnections(raw: string): Connection[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const output: Connection[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      continue;
    }
    const proto = parts[0].toLowerCase();
    if (!proto.startsWith("tcp") && !proto.startsWith("udp")) {
      continue;
    }
    const local = parseEndpoint(parts[1] ?? "");
    const remote = parseEndpoint(parts[2] ?? "");
    if (!local || !remote) {
      continue;
    }
    const state = parts[3]?.toUpperCase();
    output.push({
      protocol: proto.startsWith("tcp") ? "tcp" : "udp",
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      state
    });
  }
  return output;
}

function parseEndpoint(raw: string): { address: string; port: number } | undefined {
  if (!raw || raw === "*" || raw === "*:*") {
    return undefined;
  }
  const normalized = raw.replace(/^\[|\]$/g, "");
  const idx = normalized.lastIndexOf(":");
  if (idx < 0) {
    return undefined;
  }
  const address = normalized.slice(0, idx);
  const portRaw = normalized.slice(idx + 1);
  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    return undefined;
  }
  return { address, port };
}

function detectAnomalies(connections: Connection[], thresholdPerIp: number): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const byRemoteIp = new Map<string, number>();
  const byLocalPortUniqueIps = new Map<number, Set<string>>();
  const listening = new Set<number>();

  for (const conn of connections) {
    if (conn.state === "LISTENING" || conn.state === "LISTEN") {
      listening.add(conn.localPort);
    }
    if (isExternalIp(conn.remoteAddress)) {
      byRemoteIp.set(conn.remoteAddress, (byRemoteIp.get(conn.remoteAddress) ?? 0) + 1);
      const set = byLocalPortUniqueIps.get(conn.localPort) ?? new Set<string>();
      set.add(conn.remoteAddress);
      byLocalPortUniqueIps.set(conn.localPort, set);
    }
  }

  for (const [ip, count] of byRemoteIp.entries()) {
    if (count >= thresholdPerIp) {
      anomalies.push({
        type: "high-volume-remote-ip",
        severity: count > thresholdPerIp * 2 ? "high" : "medium",
        detail: `Remote IP ${ip} has ${count} active connections`
      });
    }
  }

  for (const [port, ips] of byLocalPortUniqueIps.entries()) {
    if (ips.size >= 30) {
      anomalies.push({
        type: "port-scan-pattern",
        severity: ips.size > 60 ? "high" : "medium",
        detail: `Local port ${port} is hit by ${ips.size} unique remote IPs`
      });
    }
  }

  for (const port of listening) {
    if (RISKY_PORTS.has(port)) {
      anomalies.push({
        type: "risky-listening-port",
        severity: port === 445 || port === 3389 ? "high" : "medium",
        detail: `Risky inbound listening port detected: ${port}`
      });
    }
  }

  return anomalies;
}

function buildRecommendations(connections: Connection[], anomalies: Anomaly[]): string[] {
  const recommendations: string[] = [];
  if (anomalies.length === 0) {
    recommendations.push("No major anomaly detected. Keep monitoring and enforce least-privilege firewall rules.");
  }
  if (anomalies.some((item) => item.type === "high-volume-remote-ip")) {
    recommendations.push("Temporarily block high-volume suspicious remote IPs and monitor recurrence.");
  }
  if (anomalies.some((item) => item.type === "port-scan-pattern")) {
    recommendations.push("Harden exposed services and restrict inbound access by allowlist.");
  }
  if (anomalies.some((item) => item.type === "risky-listening-port")) {
    recommendations.push("Close risky exposed ports or limit them to trusted management subnets.");
  }
  const listeningPorts = new Set(
    connections.filter((item) => item.state === "LISTENING" || item.state === "LISTEN").map((item) => item.localPort)
  );
  if (listeningPorts.size > 0) {
    recommendations.push(`Review open listening ports: ${[...listeningPorts].sort((a, b) => a - b).join(", ")}`);
  }
  return recommendations;
}

function applyBlockIp(ip: string, apply: boolean, confirmation: string): Record<string, unknown> {
  if (!isExternalIp(ip)) {
    return { ok: false, detail: "ipToBlock must be a valid external IPv4 address" };
  }
  const command = getBlockIpCommand(ip);
  if (!command) {
    return { ok: false, detail: `blocking not supported on ${process.platform}` };
  }
  if (!apply) {
    return { ok: true, dryRun: true, command };
  }
  if (confirmation !== ACTION_CONFIRMATION) {
    return { ok: false, detail: `confirmation token required: ${ACTION_CONFIRMATION}` };
  }
  const result = run(command);
  return {
    ok: result.ok,
    command,
    stdout: trimOutput(result.stdout),
    stderr: trimOutput(result.stderr)
  };
}

function hardenHost(
  connections: Connection[],
  allowlistPorts: number[] | undefined,
  apply: boolean,
  confirmation: string
): Record<string, unknown> {
  const listeningPorts = new Set(
    connections.filter((item) => item.state === "LISTENING" || item.state === "LISTEN").map((item) => item.localPort)
  );
  const allowed = new Set(allowlistPorts ?? []);
  const targetPorts = [...listeningPorts].filter((port) => RISKY_PORTS.has(port) && !allowed.has(port));
  const commands = targetPorts.map((port) => getClosePortCommand(port)).filter((item): item is string => Boolean(item));
  if (commands.length === 0) {
    return { ok: true, detail: "no risky listening ports required hardening", targetPorts };
  }
  if (!apply) {
    return { ok: true, dryRun: true, targetPorts, commands };
  }
  if (confirmation !== ACTION_CONFIRMATION) {
    return { ok: false, detail: `confirmation token required: ${ACTION_CONFIRMATION}`, targetPorts };
  }
  const results = commands.map((command) => {
    const out = run(command);
    return {
      command,
      ok: out.ok,
      stderr: trimOutput(out.stderr),
      stdout: trimOutput(out.stdout)
    };
  });
  return {
    ok: results.every((item) => item.ok),
    targetPorts,
    results
  };
}

function summarizeSnapshot(connections: Connection[]): Record<string, unknown> {
  const listening = connections.filter((item) => item.state === "LISTENING" || item.state === "LISTEN");
  const established = connections.filter((item) => item.state === "ESTABLISHED");
  const externalEstablished = established.filter((item) => isExternalIp(item.remoteAddress));
  return {
    totalConnections: connections.length,
    listeningPorts: [...new Set(listening.map((item) => item.localPort))].sort((a, b) => a - b),
    establishedExternalConnections: externalEstablished.length
  };
}

function isExternalIp(ip: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return false;
  }
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return false;
  }
  const second = Number(ip.split(".")[1] ?? "0");
  if (ip.startsWith("172.") && second >= 16 && second <= 31) {
    return false;
  }
  if (ip === "0.0.0.0") {
    return false;
  }
  return true;
}

function getBlockIpCommand(ip: string): string | undefined {
  if (process.platform === "win32") {
    return `netsh advfirewall firewall add rule name="NovaBlock_${ip}" dir=in action=block remoteip=${ip}`;
  }
  if (process.platform === "linux") {
    return `ufw deny from ${ip} || iptables -A INPUT -s ${ip} -j DROP`;
  }
  return undefined;
}

function getClosePortCommand(port: number): string | undefined {
  if (process.platform === "win32") {
    return `netsh advfirewall firewall add rule name="NovaClosePort_${port}" dir=in action=block protocol=TCP localport=${port}`;
  }
  if (process.platform === "linux") {
    return `ufw deny ${port}/tcp || iptables -A INPUT -p tcp --dport ${port} -j DROP`;
  }
  return undefined;
}

function run(command: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    timeout: 15_000
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function trimOutput(value: string): string {
  return value.trim().slice(0, 2000);
}

export default networkDefenseSkill;
