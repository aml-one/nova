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
  text: string;
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
