import type { ChannelMessage } from "./channel-router.js";

type SignalWebhookPayload = {
  envelope?: {
    sourceNumber?: string;
    dataMessage?: {
      message?: string;
    };
  };
  sourceNumber?: string;
  message?: string;
};

export class SignalChannelAdapter {
  async ingestSignalEvent(payload: unknown): Promise<ChannelMessage[]> {
    const parsed = payload as SignalWebhookPayload;
    const from = parsed.envelope?.sourceNumber ?? parsed.sourceNumber ?? "";
    const text = parsed.envelope?.dataMessage?.message ?? parsed.message ?? "";
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
    const baseUrl = process.env.SIGNAL_API_URL;
    const account = process.env.SIGNAL_ACCOUNT_NUMBER;
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
