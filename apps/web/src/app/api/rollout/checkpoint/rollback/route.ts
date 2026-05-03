import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/rollout/checkpoint/rollback`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "checkpoint rollback failed" }, { status: response.status });
  }
  return NextResponse.json({ ok: data.ok === true });
}

