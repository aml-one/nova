import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/models/ping`, {
    method: "POST",
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { results?: unknown[]; error?: string; correlationId?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "model ping failed" }, { status: response.status });
  }
  return NextResponse.json({ results: data.results ?? [] });
}
