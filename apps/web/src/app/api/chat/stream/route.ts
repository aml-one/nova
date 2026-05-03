import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export const maxDuration = 300;

export async function POST(request: Request) {
  const payload = (await request.json()) as { message?: string; phoneNumber?: string; imageUrl?: string; model?: string };
  const message = payload.message?.trim() ?? "";
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }
  const baseUrl = getAgentBaseUrl(request);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/chat/stream`, {
      method: "POST",
      headers: getAgentHeaders(request, true),
      body: JSON.stringify({
        message,
        phoneNumber: payload.phoneNumber,
        imageUrl: payload.imageUrl,
        model: payload.model
      }),
      signal: request.signal
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "upstream connection failed";
    return new Response(JSON.stringify({ error: `Cannot reach agent-core at ${baseUrl}: ${detail}` }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  }
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
      connection: "keep-alive",
      "x-correlation-id": response.headers.get("x-correlation-id") ?? ""
    }
  });
}

