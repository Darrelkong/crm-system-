import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_ERROR_CODES,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/constants";
import { validateSessionFromRequest } from "@/lib/auth/session";
import { getRoleDashboardPath } from "@/lib/permissions/auth";

type SessionEndReason = "idle" | "revoked" | "invalid";

function redirectToLogin(
  request: NextRequest,
  sessionEnd?: SessionEndReason,
) {
  const loginUrl = new URL("/login", request.url);
  if (sessionEnd) {
    loginUrl.searchParams.set("session_end", sessionEnd);
  } else {
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
  }
  const response = NextResponse.redirect(loginUrl);
  if (sessionEnd) {
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: "",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

function mustChangePassword(user: { mustChangePassword: number }): boolean {
  return user.mustChangePassword === 1;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  let sessionUser = null;
  let sessionEndReason: SessionEndReason | null = null;

  if (token) {
    const validation = await validateSessionFromRequest(request, { touch: true });
    if (validation.ok) {
      sessionUser = validation.session.user;
    } else if (
      validation.reason === "idle_expired" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_IDLE_EXPIRED
    ) {
      sessionEndReason = "idle";
    } else if (
      validation.reason === "revoked" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_REVOKED
    ) {
      sessionEndReason = "revoked";
    } else if (
      validation.reason === "invalid" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_INVALID
    ) {
      sessionEndReason = "invalid";
    }
  }

  if (sessionEndReason && pathname !== "/login") {
    return redirectToLogin(request, sessionEndReason);
  }

  const pendingPasswordChange =
    sessionUser != null && mustChangePassword(sessionUser);

  if (pathname === "/change-password") {
    if (!sessionUser) {
      return redirectToLogin(request);
    }
    if (!pendingPasswordChange) {
      return NextResponse.redirect(
        new URL(getRoleDashboardPath(sessionUser.role), request.url),
      );
    }
    return NextResponse.next();
  }

  if (pendingPasswordChange) {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  if (pathname === "/login") {
    if (sessionUser) {
      const destination = getRoleDashboardPath(sessionUser.role);
      return NextResponse.redirect(new URL(destination, request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/") {
    if (!sessionUser) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const destination = getRoleDashboardPath(sessionUser.role);
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
    "/change-password",
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
