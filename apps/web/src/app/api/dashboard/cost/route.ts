import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/cost/daily`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as {
    summary?: unknown;
    byProvider?: unknown[];
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "daily cost fetch failed" }, { status: response.status });
  }
  return NextResponse.json({
    summary: data.summary ?? {},
    byProvider: data.byProvider ?? []
  });
}

