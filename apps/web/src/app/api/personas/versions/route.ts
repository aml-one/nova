import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const personaId = url.searchParams.get("personaId") ?? "default";
  const rewritesOnly = url.searchParams.get("rewritesOnly") === "true";
  const response = await fetch(
    `${getAgentBaseUrl()}/v1/personas/versions?personaId=${encodeURIComponent(personaId)}&rewritesOnly=${rewritesOnly ? "true" : "false"}`,
    {
    headers: getAgentHeaders(request)
    }
  );
  const data = (await response.json()) as { items?: Array<{ version: number; createdAt: string }>; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "persona versions fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}

