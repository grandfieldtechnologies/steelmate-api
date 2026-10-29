import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Steelmate API auth uses Bearer session JWTs from the web app (cross-origin).
 * Clerk's clerkMiddleware() expects dev-browser cookies on this host in development
 * and returns signed-out / dev-browser-missing without an Authorization header.
 * Session verification runs in route handlers via verifyToken (lib/auth.ts).
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
