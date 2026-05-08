import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket
} from "@whiskeysockets/baileys";
import pino from "pino";

/** Optional override for bundled WA Web client version `[major, minor, build]`, e.g. `2,3000,1030100000` */
function waWebVersionFromEnv(): [number, number, number] | undefined {
  const raw = process.env.NOVA_WA_WEB_VERSION?.trim();
  if (!raw) return undefined;
  const parts = raw.split(/[\s,]+/).map((p) => Number.parseInt(p.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  return [parts[0], parts[1], parts[2]];
}

type BridgeState = "idle" | "starting" | "qr" | "connected" | "reconnecting" | "logged_out" | "error";

type InboundHandler = (message: { from: string; text: string }) => Promise<void> | void;

type Status = {
  state: BridgeState;
  qr?: string;
  detail?: string;
  connected: boolean;
  startedAt?: string;
  lastEventAt?: string;
  lastDisconnectCode?: number;
  lastDisconnectMessage?: string;
  lastConnection?: string;
  authDir?: string;
};

class WhatsAppWebBridge {
  private socket: WASocket | null = null;
  private state: BridgeState = "idle";
  private qr: string | undefined;
  private detail = "";
  private startedAt = "";
  private lastEventAt = "";
  private inboundHandler: InboundHandler | null = null;
  private lastDisconnectCode: number | undefined;
  private lastDisconnectMessage: string | undefined;
  private lastConnection: string | undefined;
  private startTimeoutId: NodeJS.Timeout | null = null;

  private authDir(): string {
    return resolve(process.cwd(), "data", "state", "whatsapp-baileys-auth");
  }

  async start(inboundHandler: InboundHandler, opts?: { resetAuth?: boolean }): Promise<Status> {
    this.inboundHandler = inboundHandler;

    if (opts?.resetAuth === true) {
      await this.stop();
      const dir = this.authDir();
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
      mkdirSync(dir, { recursive: true });
      this.startedAt = new Date().toISOString();
    } else if (this.socket) {
      const snap = this.getStatus();
      if (snap.state === "connected" || (snap.state === "qr" && snap.qr)) {
        return snap;
      }
      try {
        this.socket.ws.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }

    this.state = "starting";
    this.detail = "Starting WhatsApp Web bridge...";
    this.lastDisconnectCode = undefined;
    this.lastDisconnectMessage = undefined;
    this.lastConnection = undefined;
    this.touch();
    if (!this.startedAt) this.startedAt = new Date().toISOString();

    const authDir = this.authDir();
    mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // If Baileys stays in "connecting" (no QR, not open), fail after 90s — WhatsApp often needs fresh client version / network.
    if (this.startTimeoutId) clearTimeout(this.startTimeoutId);
    const hangMs = Number.parseInt(process.env.NOVA_WA_PAIRING_TIMEOUT_MS?.trim() ?? "90000", 10);
    const safeHang = Number.isFinite(hangMs) ? Math.min(Math.max(hangMs, 15_000), 300_000) : 90_000;
    this.startTimeoutId = setTimeout(() => {
      if (this.state === "connected" || (this.state === "qr" && this.qr)) {
        return;
      }
      const stuckPairing = !this.qr && (this.state === "starting" || this.state === "reconnecting");
      if (stuckPairing) {
        this.state = "error";
        this.detail = [
          "WhatsApp Web did not finish pairing (no QR / no connection) within the timeout.",
          "Check outbound HTTPS to web.whatsapp.com, system time, firewall/VPN, then set NOVA_WA_DEBUG=1 on agent-core and retry.",
          "If WhatsApp updated: set NOVA_WA_WEB_VERSION from the current web client script tag or upgrade @whiskeysockets/baileys.",
          "Alternatively use Meta Cloud API (WHATSAPP_TRANSPORT=cloud) in Settings."
        ].join(" ");
        this.touch();
        const s = this.socket;
        this.socket = null;
        if (s) {
          try {
            s.ws.close();
          } catch {
            // ignore
          }
        }
      }
    }, safeHang);

    const logger = pino({ level: process.env.NOVA_WA_DEBUG ? "info" : "silent" });
    const version = waWebVersionFromEnv();
    let sock: WASocket;
    try {
      sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.appropriate("Chrome"),
        syncFullHistory: false,
        connectTimeoutMs: 60_000,
        ...(version ? { version } : {}),
        markOnlineOnConnect: true,
        fireInitQueries: true
      });
    } catch (error) {
      if (this.startTimeoutId) {
        clearTimeout(this.startTimeoutId);
        this.startTimeoutId = null;
      }
      this.state = "error";
      this.detail = error instanceof Error ? error.message : "Failed to start WhatsApp Web bridge";
      this.touch();
      return this.getStatus();
    }
    this.socket = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
      // Always record that *something* happened so the UI can show freshness.
      this.lastConnection = update.connection ?? this.lastConnection;
      this.touch();

      const rawErr = update.lastDisconnect?.error as unknown as { output?: { statusCode?: number; payload?: { message?: string } } } | undefined;
      const statusCode = rawErr?.output?.statusCode;
      const msg = rawErr?.output?.payload?.message;
      if (typeof statusCode === "number") this.lastDisconnectCode = statusCode;
      if (typeof msg === "string" && msg.trim()) this.lastDisconnectMessage = msg.trim();

      if (update.qr) {
        this.qr = update.qr;
        this.state = "qr";
        this.detail = "Scan QR with WhatsApp on your phone (Linked devices).";
        if (this.startTimeoutId) {
          clearTimeout(this.startTimeoutId);
          this.startTimeoutId = null;
        }
      }
      if (update.connection === "open") {
        this.state = "connected";
        this.qr = undefined;
        this.detail = "WhatsApp Web bridge connected.";
        if (this.startTimeoutId) {
          clearTimeout(this.startTimeoutId);
          this.startTimeoutId = null;
        }
      }
      if (update.connection === "close") {
        if (this.startTimeoutId) {
          clearTimeout(this.startTimeoutId);
          this.startTimeoutId = null;
        }
        const stillActive = this.socket === sock;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        this.state = loggedOut ? "logged_out" : "reconnecting";
        this.detail = loggedOut ? "Logged out. Re-scan QR to reconnect." : "Connection closed. Reconnecting...";
        this.socket = null;
        if (!loggedOut && stillActive) {
          void this.start(inboundHandler).catch((error) => {
            this.state = "error";
            this.detail = error instanceof Error ? error.message : "Bridge reconnect failed";
            this.touch();
          });
        }
      }
      if (update.connection === "connecting" && this.state === "starting") {
        this.detail = "Connecting to WhatsApp… waiting for QR or connection.";
      }
    });
    sock.ev.on("messages.upsert", async (evt) => {
      if (evt.type !== "notify") return;
      for (const msg of evt.messages) {
        if (msg.key.fromMe) continue;
        const from = msg.key.remoteJid ?? "";
        const text =
          msg.message?.conversation?.trim() ||
          msg.message?.extendedTextMessage?.text?.trim() ||
          "";
        if (!from || !text) continue;
        try {
          await this.inboundHandler?.({ from, text });
        } catch {
          // Keep bridge alive even if orchestration fails.
        }
      }
    });
    return this.getStatus();
  }

  async stop(): Promise<Status> {
    const sock = this.socket;
    this.socket = null;
    if (this.startTimeoutId) {
      clearTimeout(this.startTimeoutId);
      this.startTimeoutId = null;
    }
    if (sock) {
      try {
        sock.ws.close();
      } catch {
        // Ignore close failures.
      }
    }
    this.state = "idle";
    this.detail = "WhatsApp Web bridge stopped.";
    this.qr = undefined;
    this.lastDisconnectCode = undefined;
    this.lastDisconnectMessage = undefined;
    this.lastConnection = undefined;
    this.touch();
    return this.getStatus();
  }

  async sendText(to: string, text: string): Promise<void> {
    const sock = this.socket;
    if (!sock || this.state !== "connected") {
      throw new Error("WhatsApp Web bridge is not connected");
    }
    const jid = to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: text.slice(0, 4096) });
  }

  async sendVoice(to: string, audio: Buffer, mimeType: string): Promise<void> {
    const sock = this.socket;
    if (!sock || this.state !== "connected") {
      throw new Error("WhatsApp Web bridge is not connected");
    }
    const jid = to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`;
    await sock.sendMessage(jid, { audio, mimetype: mimeType, ptt: true });
  }

  getStatus(): Status {
    return {
      state: this.state,
      qr: this.qr,
      detail: this.detail,
      connected: this.state === "connected",
      startedAt: this.startedAt || undefined,
      lastEventAt: this.lastEventAt || undefined,
      lastDisconnectCode: this.lastDisconnectCode,
      lastDisconnectMessage: this.lastDisconnectMessage,
      lastConnection: this.lastConnection,
      authDir: this.authDir()
    };
  }

  private touch(): void {
    this.lastEventAt = new Date().toISOString();
  }
}

const globalBridge = new WhatsAppWebBridge();

export async function startWhatsAppWebBridge(
  inboundHandler: InboundHandler,
  opts?: { resetAuth?: boolean }
): Promise<Status> {
  return globalBridge.start(inboundHandler, opts);
}

export async function stopWhatsAppWebBridge(): Promise<Status> {
  return globalBridge.stop();
}

export function getWhatsAppWebBridgeStatus(): Status {
  return globalBridge.getStatus();
}

export async function sendWhatsAppWebMessage(to: string, text: string): Promise<void> {
  return globalBridge.sendText(to, text);
}

export async function sendWhatsAppWebVoice(to: string, audio: Buffer, mimeType: string): Promise<void> {
  return globalBridge.sendVoice(to, audio, mimeType);
}
