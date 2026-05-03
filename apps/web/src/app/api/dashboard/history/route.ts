import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const baseUrl = getAgentBaseUrl(request);
  const response = await fetch(`${baseUrl}/v1/history`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "history fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}

