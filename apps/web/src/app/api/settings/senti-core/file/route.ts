import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/settings/senti-core/file`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}

export async function PUT(request: Request) {
  const payload = (await request.json()) as { content?: string };
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/settings/senti-core/file`, {
    method: "PUT",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as Record<string, unknown>;
  return NextResponse.json(data, { status: response.status });
}

