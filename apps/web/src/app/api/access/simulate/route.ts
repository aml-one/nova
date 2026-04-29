import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    channel?: "whatsapp" | "signal";
    phoneNumber?: string;
    text?: string;
  };
  const response = await fetch(`${getAgentBaseUrl()}/v1/access/simulate`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    return NextResponse.json({ error: String(data.error ?? "simulate failed") }, { status: response.status });
  }
  return NextResponse.json(data);
}
