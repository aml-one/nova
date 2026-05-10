import { NextResponse } from "next/server";
import { fetchFromAgent, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const body = await request.text();
  const response = await fetchFromAgent(request, "/v1/kiosk/publish", {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: body || "{}"
  });
  const text = await response.text();
  return new NextResponse(text || "{}", {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
  });
}
