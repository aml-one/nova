import type { RuntimeSkill } from "@nova/skills";

type Settings = {
  timeoutMs?: number;
  maxBytes?: number;
  maxCharsOut?: number;
  userAgent?: string;
};

type Input = {
  url?: string;
  settings?: Settings;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Block obvious SSRF targets (private ranges, metadata, localhost). */
export function assertSafePublicHttpUrl(urlString: string): URL {
  let u: URL;
  try {
    u = new URL(urlString.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (u.username || u.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    throw new Error("Localhost URLs are not allowed");
  }
  if (host === "metadata.google.internal" || host === "metadata" || host.endsWith(".internal")) {
    throw new Error("This hostname is blocked");
  }
  if (/^\[?::1\]?$/.test(host) || host === "[::ffff:127.0.0.1]") {
    throw new Error("Loopback URLs are not allowed");
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const c = Number(ipv4[3]);
    const d = Number(ipv4[4]);
    if ([a, b, c, d].some((n) => n > 255)) throw new Error("Invalid IPv4");
    if (a === 127 || a === 0) throw new Error("Private/loopback IPv4 is not allowed");
    if (a === 10) throw new Error("Private IPv4 is not allowed");
    if (a === 172 && b >= 16 && b <= 31) throw new Error("Private IPv4 is not allowed");
    if (a === 192 && b === 168) throw new Error("Private IPv4 is not allowed");
    if (a === 169 && b === 254) throw new Error("Link-local/metadata IPv4 is not allowed");
    if (a === 100 && b >= 64 && b <= 127) throw new Error("CGNAT IPv4 is not allowed");
  }
  if (host.includes(":")) {
    const inner = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    const h6 = inner.toLowerCase();
    if (h6 === "::1" || h6.startsWith("fe80:") || h6.startsWith("fc") || h6.startsWith("fd")) {
      throw new Error("IPv6 private/link-local URLs are not allowed");
    }
  }
  return u;
}

function stripHtmlToPlainText(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<\/(p|div|tr|h[1-6]|li|section|article|header|footer|main)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x11_0000 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = Number.parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code < 0x11_0000 ? String.fromCodePoint(code) : "";
    });
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

function titleFromHtml(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m?.[1]) return undefined;
  return stripHtmlToPlainText(m[1]).slice(0, 300) || undefined;
}

async function fetchWithRedirectGuard(
  startUrl: URL,
  timeoutMs: number,
  userAgent: string,
  maxBytes: number
): Promise<{ finalUrl: string; status: number; contentType: string; body: ArrayBuffer }> {
  let current = new URL(startUrl.toString());
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop < 8; hop += 1) {
    assertSafePublicHttpUrl(current.toString());
    const msLeft = Math.max(500, deadline - Date.now());
    const res = await fetch(current.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(msLeft),
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.9"
      }
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        return { finalUrl: current.toString(), status: res.status, contentType: "", body: new ArrayBuffer(0) };
      }
      current = new URL(loc, current);
      continue;
    }
    const ct = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return {
        finalUrl: current.toString(),
        status: res.status,
        contentType: ct,
        body: buf.slice(0, maxBytes)
      };
    }
    return { finalUrl: current.toString(), status: res.status, contentType: ct, body: buf };
  }
  throw new Error("Too many redirects");
}

export const urlFetchSkill: RuntimeSkill = {
  manifest: {
    id: "url-fetch",
    name: "URL fetch (read page)",
    description:
      "Fetch a public http(s) page from Nova’s host and return extracted plain text for the model. Blocks private IPs and localhost (SSRF guard).",
    permissions: ["network"],
    version: "0.1.0",
    settingsTab: {
      id: "url-fetch",
      label: "URL fetch",
      tone: "blue",
      description: "Optional limits for automatic page reads when the user pastes a link."
    }
  },
  async run(input: unknown): Promise<unknown> {
    const parsed = (input ?? {}) as Input;
    const rawUrl = String(parsed.url ?? "").trim();
    if (!rawUrl) {
      throw new Error("url is required");
    }
    const settings = parsed.settings ?? {};
    const timeoutMs = clampInt(settings.timeoutMs, 2000, 120_000, 25_000);
    const maxBytes = clampInt(settings.maxBytes, 4096, 2_000_000, 900_000);
    const maxCharsOut = clampInt(settings.maxCharsOut, 2000, 120_000, 48_000);
    const userAgent =
      String(settings.userAgent ?? "").trim() ||
      process.env.NOVA_URL_FETCH_USER_AGENT?.trim() ||
      "Mozilla/5.0 (compatible; NovaBot/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    const start = assertSafePublicHttpUrl(rawUrl);
    const { finalUrl, status, contentType, body } = await fetchWithRedirectGuard(start, timeoutMs, userAgent, maxBytes);
    if (status < 200 || status >= 400) {
      throw new Error(`HTTP ${status} when fetching ${finalUrl}`);
    }
    const dec = new TextDecoder("utf-8", { fatal: false });
    let text = dec.decode(body);
    const ctLower = contentType.toLowerCase();
    let title: string | undefined;
    if (ctLower.includes("html") || text.trimStart().toLowerCase().startsWith("<!doctype html") || text.includes("<html")) {
      title = titleFromHtml(text);
      text = stripHtmlToPlainText(text);
    } else {
      text = text.replace(/\r\n/g, "\n").trim();
    }
    const truncated = text.length > maxCharsOut;
    const outText = truncated ? `${text.slice(0, maxCharsOut)}\n\n[truncated by Nova url-fetch skill to ${maxCharsOut} characters]` : text;

    return {
      provider: "url-fetch",
      url: finalUrl,
      status,
      contentType,
      title,
      text: outText,
      truncated,
      formatted: renderFormatted(finalUrl, title, outText)
    };
  }
};

function renderFormatted(url: string, title: string | undefined, text: string): string {
  const head = [`Fetched page: ${url}`, title ? `Title: ${title}` : null].filter(Boolean).join("\n");
  return `${head}\n\n---\n\n${text}`;
}

export default urlFetchSkill;
