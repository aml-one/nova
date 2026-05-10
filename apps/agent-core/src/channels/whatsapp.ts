import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { ChannelMessage } from "./channel-router.js";
import { effectiveWhatsAppPhoneNumberId, effectiveWhatsAppToken } from "./channel-runtime-config.js";
import { sendWhatsAppWebMessage, sendWhatsAppWebVoice } from "./whatsapp-web-bridge.js";
import { tryEncodeVoicePttOggOpus } from "./whatsapp-voice-utils.js";

/** Meta Cloud API expects digits-only `to` (no `whatsapp:` prefix). */
function cloudWhatsAppRecipientDigits(to: string): string {
  const t = to.trim();
  const noPrefix = t.toLowerCase().startsWith("whatsapp:") ? t.slice("whatsapp:".length).trim() : t;
  return noPrefix.replace(/\D/g, "");
}

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          text?: { body?: string };
          type?: string;
          audio?: { id?: string; mime_type?: string; voice?: boolean };
        }>;
      };
    }>;
  }>;
};

export type WhatsAppInboundStt = (bytes: Buffer, mimeType?: string) => Promise<string>;

export type WhatsAppChannelAdapterOpts = {
  transcribeInboundVoice?: WhatsAppInboundStt;
};

async function downloadWhatsAppCloudMedia(
  mediaId: string,
  token: string,
  baseUrl: string
): Promise<{ bytes: Buffer; mimeType?: string }> {
  const root = baseUrl.replace(/\/$/, "");
  const metaRes = await fetch(`${root}/v22.0/${encodeURIComponent(mediaId)}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!metaRes.ok) {
    const body = await metaRes.text().catch(() => "");
    throw new Error(`media metadata ${metaRes.status}: ${body}`);
  }
  const meta = (await metaRes.json().catch(() => ({}))) as { url?: string; mime_type?: string };
  const mediaUrl = meta.url?.trim();
  if (!mediaUrl) {
    throw new Error("WhatsApp media metadata returned no url");
  }
  const binRes = await fetch(mediaUrl, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!binRes.ok) {
    const body = await binRes.text().catch(() => "");
    throw new Error(`media download ${binRes.status}: ${body}`);
  }
  const arrayBuf = await binRes.arrayBuffer();
  return { bytes: Buffer.from(arrayBuf), mimeType: meta.mime_type?.trim() || undefined };
}

export class WhatsAppChannelAdapter {
  constructor(
    private readonly getSettings?: () => AppSettings,
    private readonly adapterOpts?: WhatsAppChannelAdapterOpts
  ) {}

  async ingestWebhook(payload: unknown): Promise<ChannelMessage[]> {
    const parsed = payload as WhatsAppWebhookPayload;
    const messages = parsed.entry?.flatMap((entry) => entry.changes ?? []) ?? [];
    const outbound: ChannelMessage[] = [];
    const settings = this.getSettings?.();
    const baseUrl = process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com";
    const token = settings ? effectiveWhatsAppToken(settings) : process.env.WHATSAPP_TOKEN?.trim() ?? "";

    for (const change of messages) {
      for (const message of change.value?.messages ?? []) {
        const from = (message.from ?? "").trim();
        if (!from) {
          continue;
        }

        if (message.type === "text") {
          const text = message.text?.body?.trim() ?? "";
          if (!text) {
            continue;
          }
          const wamid = message.id?.trim();
          outbound.push({
            channel: "whatsapp",
            from,
            phoneNumber: from,
            text,
            ...(wamid ? { whatsappMessageId: wamid } : {})
          });
          continue;
        }

        if (message.type === "audio") {
          const mediaId = message.audio?.id?.trim() ?? "";
          if (!mediaId) {
            continue;
          }
          let bodyText = "";
          if (!token) {
            bodyText =
              "[Voice note — cannot download WhatsApp Cloud media (missing WHATSAPP_TOKEN / channel token in settings).]";
          } else {
            try {
              const { bytes, mimeType } = await downloadWhatsAppCloudMedia(mediaId, token, baseUrl);
              const transcribe = this.adapterOpts?.transcribeInboundVoice;
              if (transcribe) {
                bodyText = await transcribe(bytes, mimeType);
              } else {
                bodyText = "[Voice note received — internal error: no STT handler attached.]";
              }
            } catch (e) {
              bodyText = `[Voice note — media fetch failed: ${e instanceof Error ? e.message : String(e)}]`;
            }
          }
          const trimmed = bodyText.trim();
          if (!trimmed) {
            continue;
          }
          const wamid = message.id?.trim();
          outbound.push({
            channel: "whatsapp",
            from,
            phoneNumber: from,
            text: trimmed,
            ...(wamid ? { whatsappMessageId: wamid } : {})
          });
        }
      }
    }
    return outbound;
  }

  /**
   * WhatsApp Cloud API: mark an inbound user message as read (blue ticks), best-effort.
   * No-op for Baileys transport.
   */
  async markInboundMessageRead(messageId: string): Promise<void> {
    if ((process.env.WHATSAPP_TRANSPORT ?? "").trim().toLowerCase() === "baileys") {
      return;
    }
    const mid = messageId.trim();
    if (!mid) return;
    const settings = this.getSettings?.();
    const phoneNumberId = settings ? effectiveWhatsAppPhoneNumberId(settings) : process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = settings ? effectiveWhatsAppToken(settings) : process.env.WHATSAPP_TOKEN;
    const baseUrl = process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com";
    if (!phoneNumberId || !token) {
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
        status: "read",
        message_id: mid
      })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (process.env.NOVA_WA_DEBUG?.trim() === "1") {
        console.warn(`[whatsapp] mark read failed: ${response.status} ${body.slice(0, 400)}`);
      }
      throw new Error(`whatsapp mark read failed (${response.status}): ${body.slice(0, 300)}`);
    }
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
    const toDigits = cloudWhatsAppRecipientDigits(to);
    const response = await fetch(`${baseUrl}/v22.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toDigits,
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
    const encoded = tryEncodeVoicePttOggOpus(audio, mimeType);
    const voiceBuf = encoded ?? audio;
    const voiceMime = encoded ? "audio/ogg; codecs=opus" : mimeType || "audio/wav";
    if ((process.env.WHATSAPP_TRANSPORT ?? "").trim().toLowerCase() === "baileys") {
      await sendWhatsAppWebVoice(to, voiceBuf, voiceMime);
      return;
    }
    const settings = this.getSettings?.();
    const phoneNumberId = settings ? effectiveWhatsAppPhoneNumberId(settings) : process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = settings ? effectiveWhatsAppToken(settings) : process.env.WHATSAPP_TOKEN;
    const baseUrl = process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com";
    if (!phoneNumberId || !token) {
      console.log(`whatsapp voice send skipped (missing credentials) => ${to} (${voiceMime}, ${voiceBuf.byteLength} bytes)`);
      return;
    }

    // Avoid TS lib.dom BlobPart incompatibility with Node Buffer's ArrayBufferLike typing.
    const blob = new Blob([new Uint8Array(voiceBuf)], { type: voiceMime || "audio/ogg" });
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

    const toDigits = cloudWhatsAppRecipientDigits(to);
    const msgRes = await fetch(`${baseUrl}/v22.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toDigits,
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
