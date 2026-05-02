import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

type Params = { params: { name: string[] } };

export async function GET(request: Request, { params }: Params) {
  const name = (params.name ?? []).map((part) => encodeURIComponent(part)).join("/");
  if (!name) {
    return new Response("missing media name", { status: 400 });
  }
  const upstream = `${getAgentBaseUrl()}/v1/media/files/${name}`;
  const response = await fetch(upstream, {
    method: "GET",
    headers: getAgentHeaders(request),
    cache: "no-store"
  });
  if (!response.ok || !response.body) {
    return new Response("media not found", { status: response.status || 404 });
  }
  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable"
    }
  });
}
