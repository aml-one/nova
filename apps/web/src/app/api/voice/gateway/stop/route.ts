import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request): Promise<Response> {
  try {
    const upstream = await fetch(`${getAgentBaseUrl(request)}/v1/voice/gateway/stop`, {
      method: "POST",
      headers: { ...getAgentHeaders(request), "content-type": "application/json" },
      body: "{}"
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "stop failed" },
      { status: 502 }
    );
  }
}
