import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { ChannelMessage } from "./channel-router.js";
import { effectiveSignalAccountNumber, effectiveSignalApiUrl } from "./channel-runtime-config.js";

type DataMessageLike = {
  message?: string;
  /** Some signal-cli / REST builds use `body` for plain text. */
  body?: string;
};

type SignalWebhookPayload = {
  envelope?: {
    /** Some signal-cli / REST payloads use `source` instead of `sourceNumber`. */
    source?: string;
    sourceNumber?: string;
    dataMessage?: DataMessageLike;
    /** Edited-message wrapper seen on some envelopes. */
    editMessage?: { dataMessage?: DataMessageLike };
    /** Linked-device / sync payloads may carry text under syncMessage. */
    syncMessage?: {
      sentMessage?: DataMessageLike;
    };
  };
  sourceNumber?: string;
  message?: string;
};

function textFromDataMessage(dm: DataMessageLike | undefined): string {
  if (!dm) return "";
  const raw = dm.message ?? dm.body ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

export class SignalChannelAdapter {
  constructor(private readonly getSettings?: () => AppSettings) {}

  async ingestSignalEvent(payload: unknown): Promise<ChannelMessage[]> {
    const parsed = payload as SignalWebhookPayload;
    const from =
      parsed.envelope?.sourceNumber?.trim() ||
      (typeof parsed.envelope?.source === "string" ? parsed.envelope.source.trim() : "") ||
      parsed.sourceNumber?.trim() ||
      "";
    const dm =
      parsed.envelope?.dataMessage ??
      parsed.envelope?.editMessage?.dataMessage ??
      parsed.envelope?.syncMessage?.sentMessage;
    const text = textFromDataMessage(dm) || (typeof parsed.message === "string" ? parsed.message.trim() : "");
    if (!from || !text.trim()) {
      return [];
    }
    return [
      {
        channel: "signal",
        from,
        phoneNumber: from,
        text: text.trim()
      }
    ];
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
