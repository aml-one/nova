import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  await fetch(`${getAgentBaseUrl(request)}/v1/auth/logout`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: "{}"
  });
  const out = NextResponse.json({ ok: true });
  out.cookies.set({
    name: "nova_session",
    value: "",
    path: "/",
    maxAge: 0
  });
  return out;
}

