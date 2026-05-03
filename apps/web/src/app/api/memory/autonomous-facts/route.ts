import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const path = qs ? `/v1/memory/autonomous-facts?${qs}` : "/v1/memory/autonomous-facts";
  const response = await fetch(`${getAgentBaseUrl()}${path}`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}
