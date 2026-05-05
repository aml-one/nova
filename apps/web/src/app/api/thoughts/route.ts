import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ?? "300";
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/thoughts?limit=${encodeURIComponent(limit)}`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as {
    items?: unknown[];
    counts?: { chat?: number; learning?: number; system?: number };
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "thought fetch failed" }, { status: response.status });
  }
  return NextResponse.json({
    items: data.items ?? [],
    counts: data.counts ?? null
  });
}

