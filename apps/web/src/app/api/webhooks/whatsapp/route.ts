import { NextResponse } from "next/server";
import { getAgentBaseUrl } from "../../../../lib/agent-core";

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
  const agentRes = await fetch(agentUrl, { method: "POST", headers: forward, body: rawBody });
  const outBody = await agentRes.text();
  return new NextResponse(outBody, {
    status: agentRes.status,
    headers: {
      "content-type": agentRes.headers.get("content-type") ?? "application/json"
    }
  });
}
