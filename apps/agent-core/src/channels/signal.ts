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
  /** Signal contact name (visible even under sealed sender). */
  sourceName?: string | null;
  timestamp?: number;
  dataMessage?: DataMessageLike;
  /** Edited-message wrapper seen on some envelopes. */
  editMessage?: { dataMessage?: DataMessageLike };
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

export type SignalVoiceAttachment = {
  bytes: Buffer;
  mimeType: string;
  filename: string;
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
    // Only real inbound DMs — do not use `syncMessage.sentMessage` (linked-device echo of *your*
    // own sends); treating it as inbound mis-attributes the peer and can look like "you" messaged yourself.
    const dm = envelope?.dataMessage ?? envelope?.editMessage?.dataMessage;
    const text = textFromDataMessage(dm) || trimOrEmpty(parsed.message);
    if (!text) return [];
    const envelopeTimestamp =
      typeof envelope?.timestamp === "number" && Number.isFinite(envelope.timestamp) ? envelope.timestamp : undefined;
    const message: ChannelMessage = {
      channel: "signal",
      from: peer,
      ...(phone ? { phoneNumber: phone } : {}),
      text
    };
    if (uuid) message.signalUuid = uuid;
    if (envelopeTimestamp) message.envelopeTimestamp = envelopeTimestamp;
    const profileName = trimOrEmpty(envelope?.sourceName);
    if (profileName) message.signalSourceProfileName = profileName;
    return [message];
  }

  async sendTypingIndicator(to: string, typing: boolean): Promise<void> {
    const settings = this.getSettings?.();
    const baseUrl = settings ? effectiveSignalApiUrl(settings) : (process.env.SIGNAL_API_URL ?? "").trim();
    const account = settings ? effectiveSignalAccountNumber(settings) : (process.env.SIGNAL_ACCOUNT_NUMBER ?? "").trim();
    if (!baseUrl || !account || !to.trim()) {
      return;
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/typing-indicator/${encodeURIComponent(account)}`, {
      method: typing ? "PUT" : "DELETE",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ recipient: to })
    });
    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => "");
      throw new Error(`signal typing indicator failed (${response.status}): ${body.slice(0, 300)}`);
    }
  }

  async sendMessage(to: string, text: string, voice?: SignalVoiceAttachment): Promise<void> {
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
        base64_attachments: voice ? [`data:${voice.mimeType};filename=${voice.filename};base64,${voice.bytes.toString("base64")}`] : [],
        number: account,
        recipients: [to],
        text_mode: "normal"
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`signal send failed (${response.status}): ${body}`);
    }
  }
}
