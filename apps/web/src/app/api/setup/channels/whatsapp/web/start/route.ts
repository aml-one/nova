import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { forceNewPairing?: boolean };
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/whatsapp/web/start`, {
    method: "POST",
    headers: { "content-type": "application/json", ...getAgentHeaders(request) },
    body: JSON.stringify(payload && typeof payload === "object" ? payload : {})
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "WhatsApp Web start failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}
