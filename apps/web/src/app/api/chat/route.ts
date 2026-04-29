import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as { message?: string; phoneNumber?: string; imageUrl?: string };
  const message = payload.message?.trim() ?? "";
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const baseUrl = getAgentBaseUrl();
  const response = await fetch(`${baseUrl}/v1/chat`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({
      message,
      phoneNumber: payload.phoneNumber,
      imageUrl: payload.imageUrl
    })
  });
  const data = (await response.json()) as { reply?: string; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "agent-core request failed" }, { status: response.status });
  }
  return NextResponse.json({ reply: data.reply ?? "" });
}
