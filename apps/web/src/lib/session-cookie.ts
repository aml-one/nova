/**
 * Session cookies must only use `Secure` when the client connected over HTTPS.
 * Using NODE_ENV==="production" alone breaks login on plain HTTP (homelab / LAN):
 * the browser drops Set-Cookie and the user appears stuck with no error.
 */
export function sessionCookieSecure(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
