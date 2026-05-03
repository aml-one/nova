import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../lib/agent-core";

export async function POST(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/copilot/device-login/start`, {
    method: "POST",
    headers: getAgentHeaders(request)
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "device login start failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

