import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { ChannelMessage } from "./channel-router.js";
import { effectiveSignalAccountNumber, effectiveSignalApiUrl } from "./channel-runtime-config.js";

type DataMessageLike = {
  message?: string;
  /** Some signal-cli / REST builds use `body` for plain text. */
  body?: string;
};

type SignalEnvelopeLike = {
  /** Some signal-cli / REST payloads use `source` instead of `sourceNumber`. */
  source?: string;
  sourceNumber?: string | null;
  /** Sealed-sender Signal Service ID; present when `sourceNumber` is null on first contact. */
  sourceUuid?: string | null;
  timestamp?: number;
  dataMessage?: DataMessageLike;
  /** Edited-message wrapper seen on some envelopes. */
  editMessage?: { dataMessage?: DataMessageLike };
  /** Linked-device / sync payloads may carry text under syncMessage. */
  syncMessage?: {
    sentMessage?: DataMessageLike;
  };
};

type SignalWebhookPayload = {
  envelope?: SignalEnvelopeLike;
  /** json-rpc-mode wrapping: `{ jsonrpc, method:"receive", params: { envelope: { ... } } }`. */
  params?: { envelope?: SignalEnvelopeLike };
  /** Some bridges nest under `result` for `{ jsonrpc, id, result: { envelope } }` shapes. */
  result?: { envelope?: SignalEnvelopeLike };
  sourceNumber?: string;
  message?: string;
};

function textFromDataMessage(dm: DataMessageLike | undefined): string {
  if (!dm) return "";
  const raw = dm.message ?? dm.body ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

function pickEnvelope(parsed: SignalWebhookPayload): SignalEnvelopeLike | undefined {
  return parsed.envelope ?? parsed.params?.envelope ?? parsed.result?.envelope;
}

function trimOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Lower-cased UUID validator matching Signal sealed-sender Service IDs. */
function asSignalUuid(value: unknown): string | undefined {
  const t = trimOrEmpty(value).toLowerCase();
  if (!t) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t)) return undefined;
  return t;
}

/** True only for E.164-shaped numbers (`+` followed by 5–15 digits). */
function asPhoneNumber(value: unknown): string {
  const t = trimOrEmpty(value);
  if (!t) return "";
  return /^\+\d{5,15}$/.test(t) ? t : "";
}

export class SignalChannelAdapter {
  constructor(private readonly getSettings?: () => AppSettings) {}

  async ingestSignalEvent(payload: unknown): Promise<ChannelMessage[]> {
    if (!payload || typeof payload !== "object") return [];
    const parsed = payload as SignalWebhookPayload;
    const envelope = pickEnvelope(parsed);
    const phone =
      asPhoneNumber(envelope?.sourceNumber) ||
      asPhoneNumber(envelope?.source) ||
      asPhoneNumber(parsed.sourceNumber);
    const uuid = asSignalUuid(envelope?.sourceUuid) ?? asSignalUuid(envelope?.source);
    const peer = phone || uuid || "";
    if (!peer) return [];
    const dm =
      envelope?.dataMessage ??
      envelope?.editMessage?.dataMessage ??
      envelope?.syncMessage?.sentMessage;
    const text = textFromDataMessage(dm) || trimOrEmpty(parsed.message);
    if (!text) return [];
    const envelopeTimestamp =
      typeof envelope?.timestamp === "number" && Number.isFinite(envelope.timestamp) ? envelope.timestamp : undefined;
    const message: ChannelMessage = {
      channel: "signal",
      from: peer,
      phoneNumber: phone || peer,
      text
    };
    if (uuid) message.signalUuid = uuid;
    if (envelopeTimestamp) message.envelopeTimestamp = envelopeTimestamp;
    return [message];
  }

  async sendMessage(to: string, text: string): Promise<void> {
    const settings = this.getSettings?.();
    const baseUrl = settings ? effectiveSignalApiUrl(settings) : (process.env.SIGNAL_API_URL ?? "").trim();
    const account = settings ? effectiveSignalAccountNumber(settings) : (process.env.SIGNAL_ACCOUNT_NUMBER ?? "").trim();
    if (!baseUrl || !account) {
      console.log(`signal send skipped (missing SIGNAL_API_URL/SIGNAL_ACCOUNT_NUMBER) => ${to}: ${text}`);
      return;
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v2/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: text,
        number: account,
        recipients: [to]
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`signal send failed (${response.status}): ${body}`);
    }
  }
}
