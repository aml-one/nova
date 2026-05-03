import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/lab/workflow/traces`, {
    headers: getAgentHeaders(request)
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "workflow traces fetch failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/lab/workflow/trace/mock`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({})
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "workflow trace generation failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

