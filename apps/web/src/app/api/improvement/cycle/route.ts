import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/improvement/cycle`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: "{}"
  });
  const data = (await response.json()) as { ok?: boolean; result?: string; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "cycle failed" }, { status: response.status });
  }
  return NextResponse.json({ ok: data.ok === true, result: data.result ?? "" });
}

