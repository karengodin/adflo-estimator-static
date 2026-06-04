import { NextRequest, NextResponse } from "next/server";

// Routes that never require authentication
const PUBLIC_PREFIXES = [
  "/login",
  "/q/",
  "/intake",
  "/interview",
  "/auth/",
  "/api/interview/",
  "/api/estimator/intake/",
  "/_next",
  "/favicon.ico",
  "/adflologo.svg",
];

// Routes restricted from the Sales role
const SALES_BLOCKED_PREFIXES = [
  "/adfloxtract",
  "/migration",
  "/admin",
  "/instances",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  // API routes enforce their own auth via Bearer token.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Check session cookie — set by login page after signInWithPassword().
  const sessionCookie = req.cookies.get("adfl-session");
  if (!sessionCookie) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  // Role-based route guard for Sales users.
  const roleCookie = req.cookies.get("adfl-role")?.value;
  if (roleCookie === "sales") {
    const isBlocked = SALES_BLOCKED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    if (isBlocked) {
      const homeUrl = req.nextUrl.clone();
      homeUrl.pathname = "/";
      homeUrl.search = "";
      return NextResponse.redirect(homeUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
