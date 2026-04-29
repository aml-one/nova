import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return true;
  }
  if (!signatureHeader) {
    return false;
  }
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(expected, signatureHeader);
}

export function verifySignalSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = process.env.SIGNAL_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }
  if (!signatureHeader) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeEqual(expected, signatureHeader);
}

export function verifyInternalAuthHeader(authHeader: string | undefined): boolean {
  const token = process.env.NOVA_API_TOKEN;
  if (!token) {
    return true;
  }
  return authHeader === `Bearer ${token}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
