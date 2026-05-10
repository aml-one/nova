import { NextResponse } from "next/server";
import { fetchFromAgent, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetchFromAgent(request, "/v1/kiosk/status", {
    method: "GET",
    headers: getAgentHeaders(request)
  });
  const text = await response.text();
  return new NextResponse(text || "{}", {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
  });
}
