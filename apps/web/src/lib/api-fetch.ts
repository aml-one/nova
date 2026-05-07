/**
 * Fetch against same-origin `/api/*` routes with the session cookie.
 * Needed when the browser would otherwise omit credentials (edge cases) and for consistency across devices after login.
 */
export async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, credentials: "include" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        error: `Temporary connection problem while contacting Nova web API: ${message}`,
        temporary: true
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" }
      }
    );
  }
}
