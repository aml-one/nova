import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/auth/users`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "user list failed" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as { email?: string; password?: string };
  const response = await fetch(`${getAgentBaseUrl()}/v1/auth/users`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { user?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "create user failed" }, { status: response.status });
  }
  return NextResponse.json({ user: data.user ?? null });
}
