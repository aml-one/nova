import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request): Promise<Response> {
  try {
    const upstream = await fetch(`${getAgentBaseUrl()}/v1/voice/stt-status`, {
      headers: getAgentHeaders(request, false)
    });
    const data = (await upstream.json().catch(() => ({}))) as { configured?: boolean };
    if (!upstream.ok) {
      return NextResponse.json({ configured: false }, { status: 200 });
    }
    return NextResponse.json({ configured: Boolean(data.configured) }, { status: 200 });
  } catch {
    return NextResponse.json({ configured: false }, { status: 200 });
  }
}
