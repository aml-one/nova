import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as { message?: string; phoneNumber?: string; imageUrl?: string; model?: string };
  const message = payload.message?.trim() ?? "";
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }
  const response = await fetch(`${getAgentBaseUrl()}/v1/chat/stream`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({
      message,
      phoneNumber: payload.phoneNumber,
      imageUrl: payload.imageUrl,
      model: payload.model
    })
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return new Response(JSON.stringify({ error: data.error ?? "agent-core stream request failed" }), {
      status: response.status || 500,
      headers: { "content-type": "application/json" }
    });
  }
  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
