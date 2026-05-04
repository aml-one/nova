import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ?? "200";
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/debug/runtime-log?limit=${encodeURIComponent(limit)}`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { lines?: string[]; total?: number; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "runtime log fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ lines: data.lines ?? [], total: data.total ?? 0 });
}
