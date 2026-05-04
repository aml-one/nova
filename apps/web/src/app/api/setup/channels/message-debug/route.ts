import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ?? "150";
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/message-debug?limit=${encodeURIComponent(limit)}`, {
    headers: { ...getAgentHeaders(request) }
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "Channel message debug failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}
