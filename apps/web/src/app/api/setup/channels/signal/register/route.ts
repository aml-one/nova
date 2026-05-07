import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../lib/agent-core";

async function readUpstream(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text().catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { error: raw.trim().slice(0, 2000) };
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    signalApiUrl?: string;
    signalAccountNumber?: string;
    captcha?: string;
    useVoice?: boolean;
  };
  let response: Response;
  try {
    response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/signal/register`, {
      method: "POST",
      headers: { "content-type": "application/json", ...getAgentHeaders(request) },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not reach agent-core Signal registration endpoint: ${error instanceof Error ? error.message : String(error)}`
      },
      { status: 502 }
    );
  }
  const data = (await readUpstream(response)) as Record<string, unknown> & {
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
