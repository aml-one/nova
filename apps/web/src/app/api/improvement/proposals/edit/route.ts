import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    id?: string;
    title?: string;
    summary?: string;
    details?: string | null;
  };
  const body: Record<string, unknown> = { id: payload.id ?? "" };
  if (typeof payload.title === "string") body.title = payload.title;
  if (typeof payload.summary === "string") body.summary = payload.summary;
  if (payload.details === null || typeof payload.details === "string") body.details = payload.details;
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/improvement/proposals/edit`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(body)
  });
  const data = (await response.json()) as { item?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "proposal edit failed" }, { status: response.status });
  }
  return NextResponse.json({ item: data.item ?? null });
}
