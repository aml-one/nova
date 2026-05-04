import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function forwardCookieHeader(request: NextRequest): HeadersInit {
  const cookie = request.headers.get("cookie");
  return cookie ? { cookie } : {};
}

export async function middleware(request: NextRequest) {
  const session = request.cookies.get("nova_session")?.value;
  const { pathname } = request.nextUrl;
  const protectedPath =
    pathname === "/" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/memory") ||
    pathname.startsWith("/reports") ||
    pathname.startsWith("/knowledge") ||
    pathname.startsWith("/workflows") ||
    pathname.startsWith("/cameras") ||
    pathname.startsWith("/replay") ||
    pathname.startsWith("/sandbox") ||
    pathname.startsWith("/rollout") ||
    pathname.startsWith("/voice") ||
    pathname.startsWith("/ocr") ||
    pathname.startsWith("/skills") ||
    pathname.startsWith("/lab") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/learning") ||
    pathname.startsWith("/thoughts") ||
    pathname.startsWith("/emotion") ||
    pathname.startsWith("/security") ||
    pathname.startsWith("/services");
  let loginEnabled = true;
  try {
    const response = await fetch(new URL("/api/auth/state", request.url), {
      headers: forwardCookieHeader(request)
    });
    if (response.ok) {
      const payload = (await response.json()) as { loginEnabled?: boolean };
      loginEnabled = payload.loginEnabled !== false;
    }
  } catch {
    loginEnabled = true;
  }

  if (!loginEnabled && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (loginEnabled && !session && protectedPath) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/login")) {
    if (!loginEnabled) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    if (session) {
      try {
        const me = await fetch(new URL("/api/auth/me", request.url), {
          headers: forwardCookieHeader(request)
        });
        if (me.ok) {
          return NextResponse.redirect(new URL("/dashboard", request.url));
        }
      } catch {
        // Stale or invalid session cookie: allow the login page to render.
      }
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard",
    "/dashboard/:path*",
    "/memory/:path*",
    "/reports/:path*",
    "/knowledge/:path*",
    "/workflows/:path*",
    "/cameras/:path*",
    "/replay/:path*",
    "/sandbox/:path*",
    "/rollout/:path*",
    "/voice/:path*",
    "/ocr/:path*",
    "/skills/:path*",
    "/lab/:path*",
    "/settings/:path*",
    "/learning/:path*",
    "/thoughts/:path*",
    "/emotion/:path*",
    "/security/:path*",
    "/services/:path*"
  ]
};
