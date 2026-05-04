import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";
import { sessionCookieSecure } from "../../../../lib/session-cookie";

export async function POST(request: Request) {
  await fetch(`${getAgentBaseUrl(request)}/v1/auth/logout`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: "{}"
  });
  const out = NextResponse.json({ ok: true });
  const secure = sessionCookieSecure(request);
  out.cookies.set({
    name: "nova_session",
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 0
  });
  return out;
}

