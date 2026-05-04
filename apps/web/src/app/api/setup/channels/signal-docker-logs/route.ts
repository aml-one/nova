import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lines = url.searchParams.get("lines") ?? "200";
  const response = await fetch(
    `${getAgentBaseUrl(request)}/v1/setup/channels/signal-docker-logs?lines=${encodeURIComponent(lines)}`,
    { headers: { ...getAgentHeaders(request) } }
  );
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "Signal docker logs failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}
