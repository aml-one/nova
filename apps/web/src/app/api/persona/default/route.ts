import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/persona/default`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as {
    persona?: unknown;
    source?: string;
    filePath?: string;
    emotion?: { label?: string; valence?: number; arousal?: number };
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "persona fetch failed" }, { status: response.status });
  }
  return NextResponse.json({
    persona: data.persona,
    source: data.source,
    filePath: data.filePath,
    emotion: data.emotion
  });
}

export async function PUT(request: Request) {
  const payload = (await request.json()) as { voice?: string; style?: string[]; systemPrompt?: string };
  const response = await fetch(`${getAgentBaseUrl()}/v1/persona/default`, {
    method: "PUT",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { persona?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "persona update failed" }, { status: response.status });
  }
  return NextResponse.json({ persona: data.persona });
}

