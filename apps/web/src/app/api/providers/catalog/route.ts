import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/providers/catalog`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { models?: unknown; setup?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "provider catalog failed" }, { status: response.status });
  }
  return NextResponse.json({ models: data.models ?? {}, setup: data.setup ?? {} });
}
