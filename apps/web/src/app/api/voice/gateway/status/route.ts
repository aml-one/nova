import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request): Promise<Response> {
  try {
    const upstream = await fetch(`${getAgentBaseUrl(request)}/v1/voice/gateway/status`, {
      headers: getAgentHeaders(request, false)
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "status failed" },
      { status: 502 }
    );
  }
}
