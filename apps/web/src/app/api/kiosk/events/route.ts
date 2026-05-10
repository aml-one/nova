import { fetchFromAgent, getAgentHeaders } from "../../../../lib/agent-core";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const response = await fetchFromAgent(request, "/v1/kiosk/events", {
    method: "GET",
    headers: getAgentHeaders(request),
    cache: "no-store"
  });
  if (!response.ok) {
    const text = await response.text();
    return new Response(text || JSON.stringify({ error: "kiosk events failed" }), {
      status: response.status,
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
