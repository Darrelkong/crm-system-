import { getRequestMeta } from "@/lib/auth/cookies";
import { getDb } from "@/lib/db";
import { resolveMailActorContext } from "@/lib/mail/actor-context";
import { requireAuth } from "@/lib/permissions/auth";

export async function requireMailActor(request: Request) {
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
