export function mapInboundIdentity(channel: "whatsapp" | "signal", phoneNumber: string): string {
  const normalized = phoneNumber.replace(/[^\d+]/g, "");
  return `${channel}:${normalized.startsWith("+") ? normalized : `+${normalized}`}`;
}
