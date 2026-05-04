import { NextResponse } from "next/server";
import { getAgentBaseUrl } from "../../../../lib/agent-core";
import { reportWebhookProxyTrace } from "../../../../lib/webhook-proxy-trace";

/**
 * Forwards WhatsApp Cloud webhooks from the public web origin to agent-core.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const agentUrl = `${getAgentBaseUrl(request)}/v1/webhooks/whatsapp`;
  const forward = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) forward.set("content-type", ct);
  const hubSig = request.headers.get("x-hub-signature-256");
  if (hubSig) forward.set("x-hub-signature-256", hubSig);
  const cid = request.headers.get("x-correlation-id");
  if (cid) forward.set("x-correlation-id", cid);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let agentRes: Response;
  try {
    agentRes = await fetch(agentUrl, { method: "POST", headers: forward, body: rawBody, signal: controller.signal });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await reportWebhookProxyTrace(request, "whatsapp", "fetch_to_agent_failed", { detail });
    return NextResponse.json({ error: "forward to agent failed", detail }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  const outBody = await agentRes.text();
  if (!agentRes.ok) {
    await reportWebhookProxyTrace(request, "whatsapp", "agent_non_ok_response", {
      httpStatus: agentRes.status,
      detail: `agent returned ${agentRes.status}`,
      bodyPreview: outBody
    });
  }
  return new NextResponse(outBody, {
    status: agentRes.status,
    headers: {
      "content-type": agentRes.headers.get("content-type") ?? "application/json"
    }
  });
}
