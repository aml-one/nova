export function mapInboundIdentity(channel: "whatsapp" | "signal", phoneNumber: string): string {
  const local = phoneNumber.includes("@") ? (phoneNumber.split("@")[0] ?? phoneNumber) : phoneNumber;
  const normalized = local.replace(/[^\d+]/g, "");
  return `${channel}:${normalized.startsWith("+") ? normalized : `+${normalized}`}`;
}
