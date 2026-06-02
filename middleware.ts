import { NextRequest, NextResponse } from "next/server";

// Routes that never require authentication
const PUBLIC_PREFIXES = [
  "/login",
  "/q/",
  "/intake",
  "/interview",
  "/api/interview/",
  "/api/estimator/intake/",
  "/_next",
  "/favicon.ico",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  // API routes not in the public list enforce their own auth (Bearer token).
  // Let them through here — a 401 from the route is better than a redirect.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Check for the session cookie set by the login page after signInWithPassword().
  // The cookie is a routing signal — actual token validation happens server-side
  // in lib/adminAuth.ts (admin routes) and client-side via useRole() (UI).
  const sessionCookie = req.cookies.get("adfl-session");
  if (!sessionCookie) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
