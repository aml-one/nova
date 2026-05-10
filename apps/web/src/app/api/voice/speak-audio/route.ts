import { NextResponse } from "next/server";
import { fetchFromAgent, getAgentHeaders } from "../../../../lib/agent-core";

/** Orpheus synthesis can exceed default serverless limits; agent-core allows up to 120s per upstream call. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const response = await fetchFromAgent(request, "/v1/voice/speak-audio", {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({ text })
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    return NextResponse.json({ error: err.error ?? "tts failed" }, { status: response.status });
  }
  const mime = response.headers.get("content-type") ?? "audio/wav";
  return new NextResponse(response.body, {
    status: 200,
    headers: {
      "content-type": mime,
      "cache-control": "no-store"
    }
  });
}

