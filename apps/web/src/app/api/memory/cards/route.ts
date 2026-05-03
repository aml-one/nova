import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";
import { WEB_CHAT_EMOTION_USER_ID } from "../../../../lib/emotion-user";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? WEB_CHAT_EMOTION_USER_ID;
  const response = await fetch(`${getAgentBaseUrl()}/v1/memory/cards?userId=${encodeURIComponent(userId)}`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { items?: unknown[]; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "memory cards fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ items: data.items ?? [] });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl()}/v1/memory/cards`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { id?: string; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "memory card create failed" }, { status: response.status });
  }
  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl()}/v1/memory/cards`, {
    method: "PUT",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "memory card update failed" }, { status: response.status });
  }
  return NextResponse.json({ ok: data.ok === true });
}

export async function DELETE(request: Request) {
  const payload = await request.json();
  const response = await fetch(`${getAgentBaseUrl()}/v1/memory/cards`, {
    method: "DELETE",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "memory card delete failed" }, { status: response.status });
  }
  return NextResponse.json({ ok: data.ok === true });
}
