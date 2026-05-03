import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") ?? "";
  const response = await fetch(
    `${getAgentBaseUrl(request)}/v1/setup/copilot/device-login/status?sessionId=${encodeURIComponent(sessionId)}`,
    { headers: getAgentHeaders(request) }
  );
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "device login status failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

