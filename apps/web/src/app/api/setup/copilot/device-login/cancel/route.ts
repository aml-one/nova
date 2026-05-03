import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/copilot/device-login/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", ...getAgentHeaders(request) },
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "device login cancel failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

