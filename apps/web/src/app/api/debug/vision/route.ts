import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/debug/vision`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { debug?: unknown; correlationId?: string; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "vision debug fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ debug: data.debug ?? null, correlationId: data.correlationId });
}
