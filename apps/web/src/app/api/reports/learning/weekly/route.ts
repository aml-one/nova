import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/reports/learning/weekly`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { summary?: unknown; items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "weekly report fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ summary: data.summary ?? {}, items: data.items ?? [] });
}
