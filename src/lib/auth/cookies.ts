import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@/lib/auth/constants";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getSessionCookieOptions(expiresAt: Date) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export function getClearSessionCookieOptions() {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

export function getSessionExpiresAt(now = Date.now()): Date {
  return new Date(now + SESSION_TTL_MS);
}

export function getRequestMeta(request: Request) {
  return {
    ipAddress:
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null,
    userAgent: request.headers.get("user-agent"),
  };
}
