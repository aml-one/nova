import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const color = url.searchParams.get("color");
  const label = url.searchParams.get("label");
  const params = new URLSearchParams();
  if (color) params.set("color", color);
  if (label) params.set("label", label);
  const response = await fetch(`${getAgentBaseUrl()}/v1/camera/timeline?${params.toString()}`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "camera timeline fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}
