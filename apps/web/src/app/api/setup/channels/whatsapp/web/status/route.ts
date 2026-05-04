import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/whatsapp/web/status`, {
    headers: { ...getAgentHeaders(request) }
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "WhatsApp Web status failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}
