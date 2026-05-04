import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    signalApiUrl?: string;
    signalAccountNumber?: string;
  };
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/signal/register`, {
    method: "POST",
    headers: { "content-type": "application/json", ...getAgentHeaders(request) },
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "Signal register start failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}
