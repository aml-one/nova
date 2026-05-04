import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    signalApiUrl?: string;
    signalAccountNumber?: string;
  };
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/signal/register`, {
    method: "POST",
    headers: { "content-type": "application/json", ...getAgentHeaders(request) },
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string;
    detail?: string;
    endpointTried?: string;
    ok?: boolean;
  };
  if (!response.ok) {
    const message =
      (typeof data.error === "string" && data.error.trim()) ||
      (typeof data.detail === "string" && data.detail.trim()) ||
      "Signal register start failed";
    return NextResponse.json(
      {
        error: message,
        detail: typeof data.detail === "string" ? data.detail : undefined,
        endpointTried: typeof data.endpointTried === "string" ? data.endpointTried : undefined,
        ok: data.ok === false ? false : undefined
      },
      { status: response.status }
    );
  }
  return NextResponse.json(data);
}
