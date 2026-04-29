export function getAgentBaseUrl(): string {
  return process.env.NOVA_AGENT_API_URL ?? "http://127.0.0.1:8787";
}

export function getAgentHeaders(request?: Request, includeJsonContentType = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers["content-type"] = "application/json";
  }
  const token = process.env.NOVA_API_TOKEN;
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const sessionToken = request ? readCookie(request, "nova_session") : undefined;
  if (sessionToken) {
    headers["x-session-token"] = sessionToken;
  }
  return headers;
}

export function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie");
  if (!raw) {
    return undefined;
  }
  const entries = raw.split(";").map((entry) => entry.trim());
  const match = entries.find((entry) => entry.startsWith(`${name}=`));
  if (!match) {
    return undefined;
  }
  return decodeURIComponent(match.slice(name.length + 1));
}
