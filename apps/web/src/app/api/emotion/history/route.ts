import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const target = `${getAgentBaseUrl()}/v1/emotion/history${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`;
  const response = await fetch(target, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as {
    items?: Array<Record<string, unknown>>;
    itemsByDate?: Record<string, Array<Record<string, unknown>>>;
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "emotion history fetch failed" }, { status: response.status });
  }
  return NextResponse.json({
    items: data.items ?? [],
    itemsByDate: data.itemsByDate ?? {}
  });
}
