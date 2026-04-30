import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/workflows`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "workflows fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl()}/v1/workflows`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { id?: string; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "workflow create failed" }, { status: response.status });
  }
  return NextResponse.json({ id: data.id });
}
