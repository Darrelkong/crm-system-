import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_ERROR_CODES,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/constants";
import {
  incrementIdleReloginOnResponse,
  syncIdleReloginCookiesOnLoginVisit,
} from "@/lib/auth/idle-relogin-cookie";
import { validateSessionFromRequest } from "@/lib/auth/session";
import {
  getRoleDashboardPath,
  isAdminGuardedPath,
  resolveAdminGuardedRouteDecision,
} from "@/lib/permissions/auth";

type SessionEndReason = "idle" | "revoked" | "invalid" | "device_revoked";

async function redirectToLogin(
  request: NextRequest,
  sessionEnd?: SessionEndReason,
) {
  const loginUrl = new URL("/login", request.url);
  if (sessionEnd === "idle") {
    loginUrl.searchParams.set("reason", "timeout");
  } else if (sessionEnd) {
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
  if (sessionEnd === "idle") {
    await incrementIdleReloginOnResponse(request, response);
  }
  return response;
}

function mustChangePassword(user: { mustChangePassword: number }): boolean {
  return user.mustChangePassword === 1;
}

function redirectToStaff(request: NextRequest) {
  return NextResponse.redirect(new URL("/staff", request.url));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const adminGuardedPath = isAdminGuardedPath(pathname);

  let sessionUser = null;
  let sessionEndReason: SessionEndReason | null = null;

  if (token) {
    const validation = await validateSessionFromRequest(request, {
      touch: !adminGuardedPath,
    });
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
      validation.reason === "device_revoked" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_DEVICE_REVOKED
    ) {
      sessionEndReason = "device_revoked";
    } else if (
      validation.reason === "invalid" ||
      validation.errorCode === AUTH_ERROR_CODES.SESSION_INVALID
    ) {
      sessionEndReason = "invalid";
    }
  }

  if (sessionEndReason && pathname !== "/login") {
    return await redirectToLogin(request, sessionEndReason);
  }

  const pendingPasswordChange =
    sessionUser != null && mustChangePassword(sessionUser);

  if (pathname === "/change-password") {
    if (!sessionUser) {
      return await redirectToLogin(request);
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
    const response = NextResponse.next();
    await syncIdleReloginCookiesOnLoginVisit(request, response);
    return response;
  }

  if (pathname === "/") {
    if (!sessionUser) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const destination = getRoleDashboardPath(sessionUser.role);
    return NextResponse.redirect(new URL(destination, request.url));
  }

  const adminDecision = resolveAdminGuardedRouteDecision(pathname, sessionUser);
  if (adminDecision?.kind === "require_login") {
    return await redirectToLogin(request);
  }
  if (adminDecision?.kind === "redirect_staff") {
    return redirectToStaff(request);
  }
  if (adminDecision?.kind === "allow_admin") {
    if (token) {
      await validateSessionFromRequest(request, { touch: true });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/staff")) {
    if (!sessionUser) {
      return await redirectToLogin(request);
    }
    if (sessionUser.role === "admin") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/public-pool")) {
    if (!sessionUser) {
      return await redirectToLogin(request);
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/customers")) {
    if (!sessionUser) {
      return await redirectToLogin(request);
    }
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/approvals") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/announcements") ||
    pathname.startsWith("/help") ||
    pathname.startsWith("/follow-ups") ||
    pathname.startsWith("/reports") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/welcome")
  ) {
    if (!sessionUser) {
      return await redirectToLogin(request);
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
    "/admin",
    "/admin/:path*",
    "/import/:path*",
    "/export/:path*",
    "/staff",
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
    "/follow-ups",
    "/follow-ups/:path*",
    "/reports",
    "/reports/:path*",
    "/account",
    "/account/:path*",
    "/welcome",
    "/welcome/:path*",
  ],
};
