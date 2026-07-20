import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { getPostLogoutRedirectPath } from "@/lib/auth/logout-redirect";

export const ACCESS_REVERIFY_SESSION_END = "access_reverify" as const;

export type AccessReverifyRedirectPlan =
  | {
      kind: "access_logout";
      clearSessionCookie: true;
      incrementIdleRelogin: false;
    }
  | {
      kind: "local_login";
      destinationPath: string;
      clearSessionCookie: true;
      incrementIdleRelogin: false;
    }
  | {
      kind: "local_login_passthrough";
      clearSessionCookie: true;
      incrementIdleRelogin: false;
    };

/**
 * Pure plan for Middleware when SessionValidationResult is access_reverify.
 * Production → Cloudflare Access logout via getPostLogoutRedirectPath().
 * Development → /login?session_end=access_reverify (no Access logout loop).
 */
export function planAccessReverifyRedirect(input: {
  nodeEnv: string | undefined;
  pathname: string;
}): AccessReverifyRedirectPlan {
  const isDevelopment = input.nodeEnv === "development";

  if (isDevelopment) {
    if (input.pathname === "/login") {
      return {
        kind: "local_login_passthrough",
        clearSessionCookie: true,
        incrementIdleRelogin: false,
      };
    }
    return {
      kind: "local_login",
      destinationPath: `/login?session_end=${ACCESS_REVERIFY_SESSION_END}`,
      clearSessionCookie: true,
      incrementIdleRelogin: false,
    };
  }

  return {
    kind: "access_logout",
    clearSessionCookie: true,
    incrementIdleRelogin: false,
  };
}

/** Apply the Access-reverify Middleware response (clear CRM session cookie only). */
export function buildAccessReverifyMiddlewareResponse(
  request: NextRequest,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): NextResponse {
  const plan = planAccessReverifyRedirect({
    nodeEnv,
    pathname: request.nextUrl.pathname,
  });

  let response: NextResponse;
  if (plan.kind === "access_logout") {
    response = NextResponse.redirect(
      new URL(getPostLogoutRedirectPath(), request.url),
    );
  } else if (plan.kind === "local_login_passthrough") {
    response = NextResponse.next();
  } else {
    response = NextResponse.redirect(
      new URL(plan.destinationPath, request.url),
    );
  }

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });

  return response;
}
