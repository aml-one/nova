import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

/**
 * Read an upstream Response as JSON when possible, otherwise fall back to text wrapped in
 * `{ error }`. This prevents a non-JSON 4xx/5xx (e.g. a launch-error HTML page or a stock
 * Node error) from crashing this route handler with "Unexpected end of JSON input" and
 * cascading into an empty response body that confuses the client.
 */
async function readUpstream(response: Response): Promise<{ item?: unknown; error?: string }> {
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
    return JSON.parse(raw) as { item?: unknown; error?: string };
  } catch {
    const trimmed = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
    return { error: `Agent-core returned non-JSON (${response.status} ${response.statusText}): ${trimmed}` };
  }
}

export async function POST(request: Request) {
  let payload: { id?: string; title?: string; summary?: string; details?: string | null };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body: Record<string, unknown> = { id: payload.id ?? "" };
  if (typeof payload.title === "string") body.title = payload.title;
  if (typeof payload.summary === "string") body.summary = payload.summary;
  if (payload.details === null || typeof payload.details === "string") body.details = payload.details;

  let upstream: Response;
  try {
    upstream = await fetch(`${getAgentBaseUrl(request)}/v1/improvement/proposals/edit`, {
      method: "POST",
      headers: getAgentHeaders(request, true),
      body: JSON.stringify(body)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent-core unreachable";
    return NextResponse.json(
      { error: `Could not reach agent-core: ${message}. Has the service been restarted with the latest code?` },
      { status: 502 }
    );
  }

  const data = await readUpstream(upstream);
  if (!upstream.ok) {
    let hint = "";
    if (upstream.status === 404 && (!data.error || /not\s*found/i.test(data.error))) {
      hint =
        " (the /v1/improvement/proposals/edit endpoint is missing — agent-core probably hasn't restarted with the latest commit yet; run scripts/start-local.sh or restart the service)";
    }
    return NextResponse.json(
      { error: (data.error ?? "proposal edit failed") + hint },
      { status: upstream.status }
    );
  }
  return NextResponse.json({ item: data.item ?? null });
}
