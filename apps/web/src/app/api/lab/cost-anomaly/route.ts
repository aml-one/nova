import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/lab/cost-anomaly/check`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({})
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "cost anomaly check failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

