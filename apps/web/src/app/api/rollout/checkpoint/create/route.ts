import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const response = await fetch(`${getAgentBaseUrl()}/v1/rollout/checkpoint/create`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { id?: string; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "checkpoint create failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}
