function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function agentListenPort(): string {
  return process.env.NOVA_AGENT_PORT?.trim() || "8787";
}

/** Host part only: supports `host:port` and `[ipv6]:port`. */
function hostnameFromHostHeader(host: string | null): string | null {
  if (!host) return null;
  const t = host.trim();
  if (t.startsWith("[")) {
    const end = t.indexOf("]");
    if (end > 1) return t.slice(1, end);
    return null;
  }
  const lastColon = t.lastIndexOf(":");
  if (lastColon > 0) {
    const after = t.slice(lastColon + 1);
    if (/^\d+$/.test(after)) {
      return t.slice(0, lastColon);
    }
  }
  return t;
}

/**
 * Base URL for server-side Next.js API routes to reach agent-core.
 * Pass the incoming `Request` from the route handler so hostname inference works
 * (e.g. UI at `https://nova/` → `http://nova:8787` without `NOVA_AGENT_API_URL`).
 *
 * - Prefer `NOVA_AGENT_API_URL` when set.
 * - Else infer `http://<Host>:<NOVA_AGENT_PORT>` from `x-forwarded-host` or `Host` when not localhost.
 * - Disable with `NOVA_AGENT_API_INFER_FROM_HOST=0` or `false`.
 * - Fallback: `http://127.0.0.1:<port>`.
 */
export function getAgentBaseUrl(request?: Request): string {
  const explicit = process.env.NOVA_AGENT_API_URL?.trim();
  if (explicit) {
    return stripTrailingSlashes(explicit);
  }

  const inferDisabled =
    process.env.NOVA_AGENT_API_INFER_FROM_HOST === "0" || process.env.NOVA_AGENT_API_INFER_FROM_HOST === "false";
  if (inferDisabled) {
    return `http://127.0.0.1:${agentListenPort()}`;
  }

  if (request) {
    const hostHeader =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
    const hostname = hostnameFromHostHeader(hostHeader);
    if (
      hostname &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "::1"
    ) {
      return `http://${hostname}:${agentListenPort()}`;
    }
  }

  return `http://127.0.0.1:${agentListenPort()}`;
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
