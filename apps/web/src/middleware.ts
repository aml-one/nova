import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
    const response = await fetch(new URL("/api/auth/state", request.url));
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

  if ((!loginEnabled || session) && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
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
