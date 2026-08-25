import { getRequestMeta } from "@/lib/auth/cookies";
import { getDb, type Database } from "@/lib/db";
import { resolveMailActorContext } from "@/lib/mail/actor-context";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { requireAuth } from "@/lib/permissions/auth";
import type { User } from "../../../drizzle/schema/users";

export type MailRouteActorResult = {
  user: User;
  actor: MailActorContext;
  db: Database;
};

export type MailRouteActorResolver = (
  request: Request,
) => Promise<MailRouteActorResult>;

export async function requireMailActor(request: Request): Promise<MailRouteActorResult> {
  const user = await requireAuth(request);
  const { ipAddress, userAgent } = getRequestMeta(request);
  const db = getDb();
  const actor = await resolveMailActorContext(user, {
    db,
    audit: { ipAddress, userAgent },
  });
  return { user, actor, db };
}

export function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function readStringField(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  return typeof value === "string" ? value : undefined;
}
