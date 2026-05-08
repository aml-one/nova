import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export const maxDuration = 60;

export async function GET(request: Request) {
  const baseUrl = getAgentBaseUrl(request);
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const target = `${baseUrl}/v1/admin/people${qs ? `?${qs}` : ""}`;
  const response = await fetch(target, { headers: getAgentHeaders(request, true) });
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function PATCH(request: Request) {
  const baseUrl = getAgentBaseUrl(request);
  const body = await request.text();
  const response = await fetch(`${baseUrl}/v1/admin/people`, {
    method: "PATCH",
    headers: getAgentHeaders(request, true),
    body
  });
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

export async function DELETE(request: Request) {
  const baseUrl = getAgentBaseUrl(request);
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const target = `${baseUrl}/v1/admin/people${qs ? `?${qs}` : ""}`;
  const response = await fetch(target, { method: "DELETE", headers: getAgentHeaders(request, true) });
  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}

