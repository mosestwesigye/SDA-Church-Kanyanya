import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: bounce requests without a session cookie to the
 * sign-in page. Real authorisation happens on the server for every page and
 * action (see src/server/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const member = request.nextUrl.pathname === "/me" || request.nextUrl.pathname.startsWith("/me/");
    const url = new URL(member ? "/login/phone" : "/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|login|forgot-password|reset-password|_next|favicon.ico|sda-logo.png|manifest.webmanifest).*)"],
};
