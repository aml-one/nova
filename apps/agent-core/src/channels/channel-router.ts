export type ChannelMessage = {
  channel: "web" | "whatsapp" | "signal";
  from: string;
  phoneNumber?: string;
  /**
   * Signal sealed-sender UUID (e.g. `b1b166c7-c4cb-46f8-be4d-e596336a3355`). When present and the
   * envelope's `sourceNumber` is hidden, access policy can still match this against tier rows.
   */
  signalUuid?: string;
  /** Original envelope timestamp (ms since epoch) — used for cross-transport dedupe. */
  envelopeTimestamp?: number;
  /**
   * Signal profile display name from the envelope (`sourceName`), when present. Used with channel tier
   * `name` to link sealed-sender UUIDs when there is no People row yet.
   */
  signalSourceProfileName?: string;
  text: string;
  /** WhatsApp Cloud `wamid` — used to send read receipts back to Meta. */
  whatsappMessageId?: string;
  /** True when inbound text was produced from a Signal voice-note attachment (STT). */
  signalInboundVoiceNote?: boolean;
};

export class ChannelRouter {
  normalize(message: ChannelMessage): ChannelMessage {
    return {
      ...message,
      text: message.text.trim()
    };
  }

  normalizeBatch(messages: ChannelMessage[]): ChannelMessage[] {
    return messages.map((message) => this.normalize(message)).filter((message) => message.text.length > 0);
  }
}
