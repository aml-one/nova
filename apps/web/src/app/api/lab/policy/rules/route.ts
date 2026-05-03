import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/lab/policy/rules`, {
    headers: getAgentHeaders(request)
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "policy rules fetch failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/lab/policy/rules`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "policy rules create failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

