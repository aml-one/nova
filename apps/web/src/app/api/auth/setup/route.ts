import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as { email?: string; password?: string };
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/auth/setup`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as {
    token?: string;
    user?: { email?: string };
    error?: string;
  };
  if (!response.ok || !data.token) {
    return NextResponse.json({ error: data.error ?? "setup failed" }, { status: response.status });
  }
  const out = NextResponse.json({ user: data.user ?? null });
  out.cookies.set({
    name: "nova_session",
    value: data.token,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  return out;
}

