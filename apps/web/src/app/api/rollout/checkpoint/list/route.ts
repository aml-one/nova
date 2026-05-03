import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/rollout/checkpoint/list`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "checkpoint list failed" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}

