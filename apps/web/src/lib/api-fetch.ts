/**
 * Fetch against same-origin `/api/*` routes with the session cookie.
 * Needed when the browser would otherwise omit credentials (edge cases) and for consistency across devices after login.
 */
export function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}
