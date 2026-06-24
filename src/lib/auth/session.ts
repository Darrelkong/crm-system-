import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import { getSessionExpiresAt, getRequestMeta } from "@/lib/auth/cookies";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/token";
import type { User } from "../../../drizzle/schema/users";

export type SessionWithUser = {
  sessionId: string;
  user: User;
};

function getD1Db() {
  const { env } = getCloudflareContext();
  return drizzle(env.DB, { schema });
}

export async function createSession(
  userId: string,
  request: Request,
): Promise<{ token: string; expiresAt: Date }> {
  const db = getD1Db();
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const expiresAt = getSessionExpiresAt();
  const now = new Date().toISOString();
  const { ipAddress, userAgent } = getRequestMeta(request);

  await db.insert(schema.sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    ipAddress,
    userAgent,
    createdAt: now,
  });

  return { token, expiresAt };
}

export async function getSessionByToken(
  token: string,
): Promise<SessionWithUser | null> {
  const db = getD1Db();
  const tokenHash = await hashSessionToken(token);
  const now = new Date().toISOString();

  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      user: schema.users,
    })
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

  return row;
}

export async function destroySession(token: string): Promise<void> {
  const db = getD1Db();
  const tokenHash = await hashSessionToken(token);
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash));
}

export async function getSessionTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function getCurrentSession(): Promise<SessionWithUser | null> {
  const token = await getSessionTokenFromCookies();
  if (!token) {
    return null;
  }
  return getSessionByToken(token);
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}
