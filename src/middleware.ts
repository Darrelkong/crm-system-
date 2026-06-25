import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_ERROR_CODES,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/constants";
import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";
import { validateSessionFromRequest } from "@/lib/auth/session";

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

function redirectToAccessLogout(request: NextRequest, reason?: string) {
  const logoutUrl = new URL(getPostLogoutRedirectPath(), request.url);
  if (reason) {
    logoutUrl.searchParams.set("crm_reason", reason);
  }
  const response = NextResponse.redirect(logoutUrl);
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  let sessionUser = null;
  let sessionIdleExpired = false;

  if (token) {
    const validation = await validateSessionFromRequest(request, { touch: true });
    if (validation.ok) {
      sessionUser = validation.session.user;
    } else if (
      validation.reason === "idle_expired" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED
    ) {
      sessionIdleExpired = true;
    }
  }

  if (sessionIdleExpired && pathname !== "/login") {
    return redirectToAccessLogout(request, "idle");
  }

  if (pathname === "/login") {
    if (sessionUser) {
      const destination =
        sessionUser.role === "admin" ? "/admin" : "/staff";
      return NextResponse.redirect(new URL(destination, request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/") {
    if (!sessionUser) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const destination = sessionUser.role === "admin" ? "/admin" : "/staff";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (pathname.startsWith("/admin")) {
    if (!sessionUser) {
      return redirectToLogin(request);
    }
    if (sessionUser.role !== "admin") {
      return NextResponse.redirect(new URL("/staff", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/import") || pathname.startsWith("/export")) {
    if (!sessionUser) {
      return redirectToLogin(request);
    }
    if (sessionUser.role !== "admin") {
      return NextResponse.redirect(new URL("/staff", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/staff")) {
    if (!sessionUser) {
      return redirectToLogin(request);
    }
    if (sessionUser.role === "admin") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/public-pool")) {
    if (!sessionUser) {
      return redirectToLogin(request);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/customers")) {
    if (!sessionUser) {
      return redirectToLogin(request);
    }
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/approvals") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/announcements") ||
    pathname.startsWith("/help")
  ) {
    if (!sessionUser) {
      return redirectToLogin(request);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/admin/:path*",
    "/import/:path*",
    "/export/:path*",
    "/staff/:path*",
    "/customers",
    "/customers/:path*",
    "/public-pool",
    "/public-pool/:path*",
    "/approvals",
    "/approvals/:path*",
    "/notifications",
    "/notifications/:path*",
    "/announcements",
    "/announcements/:path*",
    "/help",
    "/help/:path*",
  ],
};
