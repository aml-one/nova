import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/websites`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "websites fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}

export async function DELETE(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl()}/v1/websites`, {
    method: "DELETE",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "website delete failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}
