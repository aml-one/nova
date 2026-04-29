export type ChannelMessage = {
  channel: "web" | "whatsapp" | "signal";
  from: string;
  phoneNumber?: string;
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
