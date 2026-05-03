import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");
  const response = await fetch(
    `${getAgentBaseUrl(request)}/v1/chat/replay${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`,
    { headers: getAgentHeaders(request) }
  );
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "chat replay fetch failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

