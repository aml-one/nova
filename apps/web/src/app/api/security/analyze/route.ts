import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/security/analyze`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "security analyze failed" }, { status: response.status });
  }
  return NextResponse.json({ result: data.result ?? null });
}
