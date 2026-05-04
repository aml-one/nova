import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";
import { sessionCookieSecure } from "../../../../lib/session-cookie";

export async function POST(request: Request) {
  let payload: { email?: string; password?: string };
  try {
    payload = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${getAgentBaseUrl(request)}/v1/auth/setup`, {
      method: "POST",
      headers: getAgentHeaders(request, true),
      body: JSON.stringify(payload)
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "agent unreachable";
    return NextResponse.json({ error: `Could not reach Nova agent: ${detail}` }, { status: 502 });
  }

  let data: {
    token?: string;
    user?: { email?: string };
    error?: string;
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    return NextResponse.json({ error: "agent returned non-JSON response" }, { status: 502 });
  }

  if (!response.ok || !data.token) {
    const status = response.ok ? 401 : response.status >= 400 ? response.status : 401;
    return NextResponse.json({ error: data.error ?? "setup failed" }, { status });
  }

  const out = NextResponse.json({ user: data.user ?? null });
  out.cookies.set({
    name: "nova_session",
    value: data.token,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(request)
  });
  return out;
}

