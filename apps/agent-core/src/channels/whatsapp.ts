import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { ChannelMessage } from "./channel-router.js";
import { effectiveWhatsAppPhoneNumberId, effectiveWhatsAppToken } from "./channel-runtime-config.js";
import { sendWhatsAppWebMessage, sendWhatsAppWebVoice } from "./whatsapp-web-bridge.js";

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          text?: { body?: string };
          type?: string;
        }>;
      };
    }>;
  }>;
};

export class WhatsAppChannelAdapter {
  constructor(private readonly getSettings?: () => AppSettings) {}

  async ingestWebhook(payload: unknown): Promise<ChannelMessage[]> {
    const parsed = payload as WhatsAppWebhookPayload;
    const messages = parsed.entry?.flatMap((entry) => entry.changes ?? []) ?? [];
    const outbound: ChannelMessage[] = [];
    for (const change of messages) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text") {
          continue;
        }
        const from = message.from ?? "";
        const text = message.text?.body?.trim() ?? "";
        if (!from || !text) {
          continue;
        }
        outbound.push({
          channel: "whatsapp",
          from,
          phoneNumber: from,
          text
        });
      }
    }
    return outbound;
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if ((process.env.WHATSAPP_TRANSPORT ?? "").trim().toLowerCase() === "baileys") {
      await sendWhatsAppWebMessage(to, text);
      return;
    }
    const settings = this.getSettings?.();
    const phoneNumberId = settings ? effectiveWhatsAppPhoneNumberId(settings) : process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = settings ? effectiveWhatsAppToken(settings) : process.env.WHATSAPP_TOKEN;
    const baseUrl = process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com";
    if (!phoneNumberId || !token) {
      console.log(`whatsapp send skipped (missing credentials) => ${to}: ${text}`);
      return;
    }
    const response = await fetch(`${baseUrl}/v22.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text.slice(0, 4096) }
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`whatsapp send failed (${response.status}): ${body}`);
    }
  }

  async sendVoiceMessage(to: string, audio: Buffer, mimeType: string): Promise<void> {
    if ((process.env.WHATSAPP_TRANSPORT ?? "").trim().toLowerCase() === "baileys") {
      await sendWhatsAppWebVoice(to, audio, mimeType);
      return;
    }
    const settings = this.getSettings?.();
    const phoneNumberId = settings ? effectiveWhatsAppPhoneNumberId(settings) : process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = settings ? effectiveWhatsAppToken(settings) : process.env.WHATSAPP_TOKEN;
    const baseUrl = process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com";
    if (!phoneNumberId || !token) {
      console.log(`whatsapp voice send skipped (missing credentials) => ${to} (${mimeType}, ${audio.byteLength} bytes)`);
      return;
    }

    // Avoid TS lib.dom BlobPart incompatibility with Node Buffer's ArrayBufferLike typing.
    const blob = new Blob([new Uint8Array(audio)], { type: mimeType || "audio/ogg" });
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "audio");
    form.append("file", blob, "nova-voice-note");

    const mediaRes = await fetch(`${baseUrl}/v22.0/${phoneNumberId}/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form
    });
    if (!mediaRes.ok) {
      const body = await mediaRes.text().catch(() => "");
      throw new Error(`whatsapp media upload failed (${mediaRes.status}): ${body}`);
    }
    const mediaJson = (await mediaRes.json().catch(() => ({}))) as { id?: string };
    const mediaId = mediaJson.id?.trim() ?? "";
    if (!mediaId) {
      throw new Error("whatsapp media upload returned no id");
    }

    const msgRes = await fetch(`${baseUrl}/v22.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: mediaId }
      })
    });
    if (!msgRes.ok) {
      const body = await msgRes.text().catch(() => "");
      throw new Error(`whatsapp audio message failed (${msgRes.status}): ${body}`);
    }
  }
}
