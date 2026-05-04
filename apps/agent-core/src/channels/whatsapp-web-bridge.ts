import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import makeWASocket, { DisconnectReason, useMultiFileAuthState, type WASocket } from "@whiskeysockets/baileys";
import pino from "pino";

type BridgeState = "idle" | "starting" | "qr" | "connected" | "reconnecting" | "logged_out" | "error";

type InboundHandler = (message: { from: string; text: string }) => Promise<void> | void;

type Status = {
  state: BridgeState;
  qr?: string;
  detail?: string;
  connected: boolean;
  startedAt?: string;
  lastEventAt?: string;
};

class WhatsAppWebBridge {
  private socket: WASocket | null = null;
  private state: BridgeState = "idle";
  private qr: string | undefined;
  private detail = "";
  private startedAt = "";
  private lastEventAt = "";
  private inboundHandler: InboundHandler | null = null;

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
    this.touch();
    if (!this.startedAt) this.startedAt = new Date().toISOString();

    const authDir = this.authDir();
    mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const logger = pino({ level: "silent" });
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger
    });
    this.socket = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => {
      if (update.qr) {
        this.qr = update.qr;
        this.state = "qr";
        this.detail = "Scan QR with WhatsApp on your phone (Linked devices).";
        this.touch();
      }
      if (update.connection === "open") {
        this.state = "connected";
        this.qr = undefined;
        this.detail = "WhatsApp Web bridge connected.";
        this.touch();
      }
      if (update.connection === "close") {
        const stillActive = this.socket === sock;
        const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        this.state = loggedOut ? "logged_out" : "reconnecting";
        this.detail = loggedOut ? "Logged out. Re-scan QR to reconnect." : "Connection closed. Reconnecting...";
        this.touch();
        this.socket = null;
        if (!loggedOut && stillActive) {
          void this.start(inboundHandler).catch((error) => {
            this.state = "error";
            this.detail = error instanceof Error ? error.message : "Bridge reconnect failed";
            this.touch();
          });
        }
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

  getStatus(): Status {
    return {
      state: this.state,
      qr: this.qr,
      detail: this.detail,
      connected: this.state === "connected",
      startedAt: this.startedAt || undefined,
      lastEventAt: this.lastEventAt || undefined
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
