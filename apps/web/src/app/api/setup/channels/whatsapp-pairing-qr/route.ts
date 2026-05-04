import { NextResponse } from "next/server";
import QRCode from "qrcode";

const MAX_PAIRING_LEN = 20_000;

/**
 * Renders a WhatsApp Web pairing string as PNG. Kept server-side so the client bundle
 * does not depend on `qrcode` (avoids "module not found" when installs omit dev/workspace deps).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { raw?: string };
  const raw = typeof body.raw === "string" ? body.raw.trim() : "";
  if (!raw) {
    return NextResponse.json({ error: "raw is required" }, { status: 400 });
  }
  if (raw.length > MAX_PAIRING_LEN) {
    return NextResponse.json({ error: "raw too large" }, { status: 400 });
  }
  try {
    const png = await QRCode.toBuffer(raw, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320
    });
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store"
      }
    });
  } catch {
    return NextResponse.json({ error: "could not render QR" }, { status: 500 });
  }
}
