import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export const maxDuration = 60;

export async function POST(request: Request) {
  const baseUrl = getAgentBaseUrl(request);
  const body = await request.text();
  const response = await fetch(`${baseUrl}/v1/admin/people/merge`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body
  });
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

