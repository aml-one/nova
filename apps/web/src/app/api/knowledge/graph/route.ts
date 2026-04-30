import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/knowledge/graph`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { nodes?: unknown[]; edges?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "knowledge graph fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ nodes: data.nodes ?? [], edges: data.edges ?? [] });
}
