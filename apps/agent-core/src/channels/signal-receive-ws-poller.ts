import WebSocket from "ws";
import type { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";
import type { OutboundDispatcher } from "../messaging/outbound-dispatcher.js";
import type { SettingsService } from "../settings/settings-service.js";
import type { SignalChannelAdapter } from "./signal.js";
import type { ChannelRouter } from "./channel-router.js";
import { effectiveSignalAccountNumber, effectiveSignalApiUrl } from "./channel-runtime-config.js";
import { previewChannelText, pushChannelDebug } from "./channel-debug-log.js";
import { dispatchSignalInboundMessages } from "./signal-inbound-dispatch.js";

function stripSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function buildReceiveWebSocketUrl(signalApiBase: string, account: string): string | null {
  const raw = stripSlash(signalApiBase.trim());
  if (!raw || !account.trim()) {
    return null;
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  const path = stripSlash(u.pathname || "");
  const prefix = path && path !== "/" ? path : "";
  const enc = encodeURIComponent(account.trim());
  return `${wsProto}//${u.host}${prefix}/v1/receive/${enc}`;
}

const dedupe = new Map<string, number>();
const DEDUPE_TTL_MS = 120_000;

function dedupeKey(chunk: unknown, message: { from: string; text: string }): string {
  const env = (chunk as { envelope?: { sourceNumber?: string; source?: string; timestamp?: number } }).envelope;
  const from = message.from.trim() || env?.sourceNumber?.trim() || (typeof env?.source === "string" ? env.source.trim() : "") || "";
  const ts = typeof env?.timestamp === "number" ? env.timestamp : 0;
  return `${from}|${ts}|${message.text.slice(0, 120)}`;
}

function shouldProcess(key: string): boolean {
  const now = Date.now();
  for (const [k, exp] of dedupe) {
    if (exp < now) {
      dedupe.delete(k);
    }
  }
  if (dedupe.has(key)) {
    return false;
  }
  dedupe.set(key, now + DEDUPE_TTL_MS);
  return true;
}

function parseWsPayload(raw: WebSocket.RawData): unknown[] {
  const s = typeof raw === "string" ? raw : raw.toString("utf8");
  const trimmed = s.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (Array.isArray(v)) {
      return [...v];
    }
    return [v];
  } catch {
    // NDJSON / line-delimited fallback (must be one JSON object per line)
    const out: unknown[] = [];
    for (const line of trimmed.split(/\n+/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        const v = JSON.parse(t) as unknown;
        if (Array.isArray(v)) {
          out.push(...v);
        } else {
          out.push(v);
        }
      } catch {
        // skip bad line
      }
    }
    return out;
  }
}

let lastReceiveWsNonDmLogAt = 0;
const RECEIVE_WS_DEBUG_THROTTLE_MS = 12_000;

/**
 * bbernhard/signal-cli-rest-api closes the receive WebSocket every ~35 s on idle. Logging every
 * routine reconnect drowns out real signal traffic in the channel debug trace, so we only log a
 * connect when (a) it is the very first connect after agent-core boot, (b) the previous close was
 * preceded by an explicit error, or (c) we have not logged a reconnect in the last 10 minutes
 * (so the user can still see the WS is alive on a quiet day).
 */
let firstReceiveWsConnectLogged = false;
let lastReceiveWsConnectLogAt = 0;
let receiveWsHadErrorSinceLastConnect = false;
const RECEIVE_WS_CONNECT_LOG_INTERVAL_MS = 10 * 60 * 1000;

function maybeLogReceiveWsNonTextDm(preview: string): void {
  const now = Date.now();
  if (now - lastReceiveWsNonDmLogAt < RECEIVE_WS_DEBUG_THROTTLE_MS) {
    return;
  }
  lastReceiveWsNonDmLogAt = now;
  pushChannelDebug({
    channel: "signal",
    direction: "in",
    transport: "receive_ws",
    correlationId: "signal-ws",
    peer: "",
    textPreview: previewChannelText(preview, 220),
    trace: ["receive_ws_frame", "parsed_zero_text_dm_or_receipt"],
    error: "WebSocket delivered JSON but no inbound text DM was extracted — expand signal ingest or check payload shape."
  });
}

/**
 * Subscribes to signal-cli-rest-api `/v1/receive/{number}` over WebSocket so inbound messages reach Nova
 * even when RECEIVE_WEBHOOK_URL is wrong or unreachable (split Docker / agent hosts).
 * Disable with SIGNAL_RECEIVE_WEBSOCKET=0.
 */
export function startSignalReceiveWsPoller(deps: {
  orchestrator: TaskOrchestrator;
  settings: SettingsService;
  dispatcher: OutboundDispatcher;
  router: ChannelRouter;
  signal: SignalChannelAdapter;
}): void {
  if ((process.env.SIGNAL_RECEIVE_WEBSOCKET ?? "1").trim() === "0") {
    return;
  }

  let ws: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (ms: number, fn: () => void) => {
    if (stopped) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    reconnectTimer = setTimeout(fn, ms);
  };

  const connect = () => {
    if (stopped) return;
    const settings = deps.settings.get();
    const base = effectiveSignalApiUrl(settings);
    const account = effectiveSignalAccountNumber(settings);
    const url = buildReceiveWebSocketUrl(base, account);
    if (!url) {
      schedule(8000, connect);
      return;
    }

    try {
      ws = new WebSocket(url);
    } catch {
      schedule(5000, connect);
      return;
    }

    ws.on("open", () => {
      const now = Date.now();
      const sinceLastLog = now - lastReceiveWsConnectLogAt;
      const shouldLog =
        !firstReceiveWsConnectLogged ||
        receiveWsHadErrorSinceLastConnect ||
        sinceLastLog >= RECEIVE_WS_CONNECT_LOG_INTERVAL_MS;
      firstReceiveWsConnectLogged = true;
      receiveWsHadErrorSinceLastConnect = false;
      if (!shouldLog) {
        return;
      }
      lastReceiveWsConnectLogAt = now;
      pushChannelDebug({
        channel: "signal",
        direction: "in",
        transport: "receive_ws",
        correlationId: "signal-ws",
        peer: "",
        textPreview: "(receive WebSocket connected)",
        trace: ["receive_ws_connected", previewChannelText(url, 120)]
      });
    });

    ws.on("message", async (raw) => {
      const rawStr = typeof raw === "string" ? raw : raw.toString("utf8");
      const chunks = parseWsPayload(raw);
      if (chunks.length === 0 && rawStr.trim().length > 2) {
        maybeLogReceiveWsNonTextDm(rawStr);
        return;
      }
      for (const chunk of chunks) {
        const messages = deps.router.normalizeBatch(await deps.signal.ingestSignalEvent(chunk));
        if (messages.length === 0) {
          const preview = typeof chunk === "object" && chunk !== null ? JSON.stringify(chunk) : String(chunk);
          if (preview.length > 20) {
            maybeLogReceiveWsNonTextDm(preview);
          }
          continue;
        }
        const filtered = messages.filter((m) => shouldProcess(dedupeKey(chunk, m)));
        if (filtered.length === 0) {
          continue;
        }
        await dispatchSignalInboundMessages(filtered, {
          orchestrator: deps.orchestrator,
          settings: deps.settings,
          dispatcher: deps.dispatcher,
          signal: deps.signal,
          transport: "receive_ws"
        });
      }
    });

    ws.on("error", (err) => {
      receiveWsHadErrorSinceLastConnect = true;
      pushChannelDebug({
        channel: "signal",
        direction: "in",
        transport: "receive_ws",
        correlationId: "signal-ws",
        peer: "",
        textPreview: previewChannelText(String(err)),
        trace: ["receive_ws_error"],
        error: err instanceof Error ? err.message : String(err)
      });
    });

    ws.on("close", () => {
      ws = null;
      schedule(4000, connect);
    });
  };

  connect();

  const onShutdown = () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      ws?.close();
    } catch {
      // ignore
    }
  };
  process.once("SIGTERM", onShutdown);
  process.once("SIGINT", onShutdown);
}
