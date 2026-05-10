import { NextResponse } from "next/server";
import { fetchFromAgent, getAgentHeaders } from "../../../../lib/agent-core";

/** Inspect TTS pipeline without calling Orpheus; same transforms as speak-audio. */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = typeof body.text === "string" ? body.text : "";
  const response = await fetchFromAgent(request, "/v1/voice/tts-trace", {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({ text })
  });
  const data = (await response.json()) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}

