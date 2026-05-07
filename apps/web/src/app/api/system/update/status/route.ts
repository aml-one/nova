import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

async function readUpstream(response: Response): Promise<{ status?: unknown; error?: string }> {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    return { error: `Agent-core returned an unreadable body (${response.status} ${response.statusText})` };
  }
  if (!raw.trim()) {
    return { error: `Agent-core returned an empty body (${response.status} ${response.statusText})` };
  }
  try {
    return JSON.parse(raw) as { status?: unknown; error?: string };
  } catch {
    const preview = raw.length > 400 ? `${raw.slice(0, 400)}...` : raw;
    return { error: `Agent-core returned non-JSON (${response.status} ${response.statusText}): ${preview}` };
  }
}

export async function GET(request: Request) {
  let response: Response;
  try {
    response = await fetch(`${getAgentBaseUrl(request)}/v1/system/update/status`, {
      headers: getAgentHeaders(request)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent-core unreachable";
    return NextResponse.json({ error: `Could not reach agent-core: ${message}` }, { status: 502 });
  }
  const data = await readUpstream(response);
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "update status failed" }, { status: response.status });
  }
  return NextResponse.json({ status: data.status ?? null });
}

