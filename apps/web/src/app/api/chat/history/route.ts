import { NextRequest, NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: NextRequest) {
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(500, Number(limitRaw || 100) || 100));
  const response = await fetch(`${getAgentBaseUrl()}/v1/history?limit=${limit}`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json().catch(() => ({}))) as { items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "Could not fetch chat history" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}
