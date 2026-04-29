import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { label?: string };
  const response = await fetch(`${getAgentBaseUrl()}/v1/backup/identity/push`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({ label: payload.label })
  });
  const data = (await response.json()) as {
    snapshotPath?: string;
    branch?: string;
    sanity?: { ok: boolean; checks?: Array<Record<string, unknown>> };
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "identity backup push failed" }, { status: response.status });
  }
  return NextResponse.json({
    snapshotPath: data.snapshotPath,
    branch: data.branch,
    sanity: data.sanity
  });
}
