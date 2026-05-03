import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.byteLength) {
    return NextResponse.json({ error: "audio payload is empty" }, { status: 400 });
  }
  const audioBase64 = Buffer.from(bytes).toString("base64");
  const upstream = await fetch(`${getAgentBaseUrl(request)}/v1/voice/transcribe-audio`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({
      audioBase64,
      mimeType: file.type || "application/octet-stream"
    })
  });
  const data = (await upstream.json().catch(() => ({}))) as { error?: string; text?: string };
  if (!upstream.ok) {
    return NextResponse.json({ error: data.error ?? "transcription failed" }, { status: upstream.status });
  }
  return NextResponse.json({ text: data.text ?? "" }, { status: 200 });
}

