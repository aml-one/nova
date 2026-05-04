import { NextResponse } from "next/server";
import { getAgentBaseUrl } from "../../../../lib/agent-core";

/**
 * Forwards Signal webhooks from the public web origin to agent-core.
 * Use when signal-cli-rest-api can reach your HTTPS site but not the agent port directly.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const agentUrl = `${getAgentBaseUrl(request)}/v1/webhooks/signal`;
  const forward = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) forward.set("content-type", ct);
  const sig = request.headers.get("x-signal-signature");
  if (sig) forward.set("x-signal-signature", sig);
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
