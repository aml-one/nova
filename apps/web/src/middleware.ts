import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const session = request.cookies.get("nova_session")?.value;
  const { pathname } = request.nextUrl;
  const protectedPath =
    pathname === "/" ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/learning") ||
    pathname.startsWith("/emotion") ||
    pathname.startsWith("/security");
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
  matcher: ["/", "/login", "/dashboard/:path*", "/settings/:path*", "/learning/:path*", "/emotion/:path*", "/security/:path*"]
};
