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
  const payload = (await request.json().catch(() => ({}))) as { signalApiUrl?: string };
  let response: Response;
  try {
    response = await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/signal/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json", ...getAgentHeaders(request) },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not reach agent-core Signal accounts endpoint: ${error instanceof Error ? error.message : String(error)}`
      },
      { status: 502 }
    );
  }
  const data = (await readUpstream(response)) as Record<string, unknown> & {
    error?: string;
    detail?: string;
    accounts?: string[];
    ok?: boolean;
  };
  if (!response.ok) {
    const message =
      (typeof data.error === "string" && data.error.trim()) ||
      (typeof data.detail === "string" && data.detail.trim()) ||
      "Signal accounts list failed";
    return NextResponse.json(
      {
        error: message,
        detail: typeof data.detail === "string" ? data.detail : undefined
      },
      { status: response.status }
    );
  }
  return NextResponse.json(data);
}
