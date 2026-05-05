import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as { id?: string; status?: string };
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/improvement/proposals/status`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({
      id: payload.id ?? "",
      status: payload.status ?? ""
    })
  });
  const data = (await response.json()) as { item?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "proposal status update failed" }, { status: response.status });
  }
  return NextResponse.json({ item: data.item ?? null });
}

