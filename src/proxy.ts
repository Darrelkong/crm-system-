import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../drizzle/schema";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/token";

async function getSessionUser(token: string) {
  const { env } = getCloudflareContext();
  const db = drizzle(env.DB, { schema });
  const tokenHash = await hashSessionToken(token);
  const now = new Date().toISOString();

  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.sessions.tokenHash, tokenHash),
        gt(schema.sessions.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.user.isActive !== 1) {
    return null;
  }
  return row.user;
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  const sessionUser = token ? await getSessionUser(token) : null;

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
  ],
};
