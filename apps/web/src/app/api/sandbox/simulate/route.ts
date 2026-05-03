import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/sandbox/simulate`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { simulation?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "sandbox simulation failed" }, { status: response.status });
  }
  return NextResponse.json({ simulation: data.simulation ?? null });
}

