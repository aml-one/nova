import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

/** Recent chat/read-aloud TTS pipeline snapshots from agent-core (in-memory ring buffer). */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ?? "20";
  const agentUrl = `${getAgentBaseUrl()}/v1/voice/tts-recent?limit=${encodeURIComponent(limit)}`;
  let agentResponse: Response;
  try {
    agentResponse = await fetch(agentUrl, { headers: getAgentHeaders(request, false), cache: "no-store" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "upstream failed";
    return NextResponse.json({ error: `Cannot reach agent-core: ${detail}` }, { status: 503 });
  }
  const data = (await agentResponse.json().catch(() => ({}))) as Record<string, unknown>;
  return NextResponse.json(data, { status: agentResponse.status });
}
