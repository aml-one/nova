import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const response = await fetch(`${getAgentBaseUrl()}/v1/voice/speak-audio`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    return NextResponse.json({ error: err.error ?? "tts failed" }, { status: response.status });
  }
  const mime = response.headers.get("content-type") ?? "audio/mpeg";
  const buf = await response.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": mime,
      "cache-control": "no-store"
    }
  });
}
