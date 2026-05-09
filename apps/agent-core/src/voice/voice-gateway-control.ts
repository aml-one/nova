import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const NOVA_VOICE_GATEWAY_LABEL = "com.nova.voice-gateway";
const DEFAULT_PLIST = `/Library/LaunchDaemons/${NOVA_VOICE_GATEWAY_LABEL}.plist`;
const DEFAULT_GATEWAY_HEALTH_URL = process.env.NOVA_VOICE_GATEWAY_HEALTH_URL ?? "http://127.0.0.1:8790/health";

function plistPath(): string {
  return process.env.NOVA_VOICE_GATEWAY_PLIST?.trim() || DEFAULT_PLIST;
}

export type VoiceGatewayStatusPayload = {
  platform: NodeJS.Platform;
  controlSupported: boolean;
  plistPath: string;
  plistPresent: boolean;
  launchdLoaded: boolean;
  healthy: boolean;
  healthBody?: string;
  detail?: string;
};

async function launchctl(args: string[], timeoutMs = 20000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("launchctl", args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
}

export function isVoiceGatewayLaunchdControlSupported(): boolean {
  return process.platform === "darwin";
}

async function isJobLoaded(): Promise<boolean> {
  try {
    const { stdout, stderr } = await launchctl(["print", `system/${NOVA_VOICE_GATEWAY_LABEL}`]);
    const out = `${stdout}\n${stderr}`;
    if (/not found/i.test(out)) {
      return false;
    }
    return /state\s*=/.test(out);
  } catch {
    return false;
  }
}

async function fetchHealth(): Promise<{ ok: boolean; body: string }> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3500);
    const r = await fetch(DEFAULT_GATEWAY_HEALTH_URL, { signal: ac.signal });
    clearTimeout(t);
    const body = await r.text();
    return { ok: r.ok, body };
  } catch (e) {
    return { ok: false, body: e instanceof Error ? e.message : String(e) };
  }
}

export async function getVoiceGatewayStatus(): Promise<VoiceGatewayStatusPayload> {
  const path = plistPath();
  const plistPresent = existsSync(path);
  if (!isVoiceGatewayLaunchdControlSupported()) {
    const h = await fetchHealth();
    return {
      platform: process.platform,
      controlSupported: false,
      plistPath: path,
      plistPresent,
      launchdLoaded: false,
      healthy: h.ok,
      healthBody: h.body,
      detail: "LaunchDaemon control is only implemented on macOS."
    };
  }
  const launchdLoaded = await isJobLoaded();
  const h = await fetchHealth();
  return {
    platform: process.platform,
    controlSupported: true,
    plistPath: path,
    plistPresent,
    launchdLoaded,
    healthy: h.ok,
    healthBody: h.body
  };
}

function rootCheck(): { ok: true } | { ok: false; message: string } {
  if (process.getuid?.() !== 0) {
    return {
      ok: false,
      message: "Voice gateway LaunchDaemon control requires agent-core running as root (standard macOS Nova install)."
    };
  }
  return { ok: true };
}

export async function voiceGatewayStart(): Promise<{ ok: boolean; message: string }> {
  const rc = rootCheck();
  if (!rc.ok) {
    return rc;
  }
  const path = plistPath();
  if (!existsSync(path)) {
    return {
      ok: false,
      message: `Missing ${path}. Run: sudo bash ./scripts/install-macos-voice-gateway-service.sh`
    };
  }
  const loaded = await isJobLoaded();
  if (!loaded) {
    await launchctl(["bootstrap", "system", path]);
    await launchctl(["enable", `system/${NOVA_VOICE_GATEWAY_LABEL}`]).catch(() => {});
  }
  await launchctl(["kickstart", "-k", `system/${NOVA_VOICE_GATEWAY_LABEL}`]);
  return { ok: true, message: loaded ? "kickstarted" : "bootstrapped and started" };
}

export async function voiceGatewayStop(): Promise<{ ok: boolean; message: string }> {
  const rc = rootCheck();
  if (!rc.ok) {
    return rc;
  }
  await launchctl(["bootout", `system/${NOVA_VOICE_GATEWAY_LABEL}`]).catch(() => {});
  return { ok: true, message: "bootout (service unloaded until next start/bootstrap)" };
}

export async function voiceGatewayRestart(): Promise<{ ok: boolean; message: string }> {
  const rc = rootCheck();
  if (!rc.ok) {
    return rc;
  }
  const path = plistPath();
  if (!existsSync(path)) {
    return {
      ok: false,
      message: `Missing ${path}. Run: sudo bash ./scripts/install-macos-voice-gateway-service.sh`
    };
  }
  const loaded = await isJobLoaded();
  if (loaded) {
    await launchctl(["kickstart", "-k", `system/${NOVA_VOICE_GATEWAY_LABEL}`]);
    return { ok: true, message: "kickstarted (restart)" };
  }
  await launchctl(["bootstrap", "system", path]);
  await launchctl(["enable", `system/${NOVA_VOICE_GATEWAY_LABEL}`]).catch(() => {});
  await launchctl(["kickstart", "-k", `system/${NOVA_VOICE_GATEWAY_LABEL}`]);
  return { ok: true, message: "bootstrapped and started" };
}
