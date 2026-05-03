import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/test`, {
    method: "POST",
    headers: { "content-type": "application/json", ...getAgentHeaders(request) },
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "channel setup test failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

