import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as { uploadId?: string; base64?: string };
  const response = await fetch(`${getAgentBaseUrl()}/v1/media/upload/chunk`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "upload chunk failed" }, { status: response.status });
  }
  return NextResponse.json({ ok: data.ok === true });
}
