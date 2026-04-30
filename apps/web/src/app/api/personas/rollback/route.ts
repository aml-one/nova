import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { personaId?: string; version?: number };
  const response = await fetch(`${getAgentBaseUrl()}/v1/personas/rollback`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({
      personaId: payload.personaId ?? "default",
      version: Number(payload.version ?? 0)
    })
  });
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "persona rollback failed" }, { status: response.status });
  }
  return NextResponse.json({ ok: true });
}

