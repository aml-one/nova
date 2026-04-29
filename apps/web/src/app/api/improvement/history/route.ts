import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/improvement/history`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { itemsByDate?: Record<string, unknown[]>; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "history fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ itemsByDate: data.itemsByDate ?? {} });
}
