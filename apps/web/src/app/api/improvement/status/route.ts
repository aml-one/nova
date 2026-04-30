import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/improvement/status`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { status?: Record<string, unknown> | null; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "improvement status fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ status: data.status ?? null });
}

