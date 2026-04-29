import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/system/health/full`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { health?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "health fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ health: data.health ?? null });
}
