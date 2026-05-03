import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/auth/me`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { user?: { email?: string } | null; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "unauthorized" }, { status: response.status });
  }
  return NextResponse.json({ user: data.user ?? null });
}

