import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/lab/camera-watchlist`, {
    headers: getAgentHeaders(request)
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "watchlist fetch failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/lab/camera-watchlist`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "watchlist create failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/lab/camera-watchlist`, {
    method: "DELETE",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: (data as { error?: string }).error ?? "watchlist delete failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

