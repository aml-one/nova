import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/improvement/proposals/events?id=${encodeURIComponent(id)}&limit=120`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { events?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "proposal events fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ events: data.events ?? [] });
}

