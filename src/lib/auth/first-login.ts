import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

/**
 * Records the first successful CRM application login exactly once.
 * Access verification, device authorization, and failed logins do not call this.
 */
export async function recordFirstSuccessfulCrmLogin(
  db: Database,
  userId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const updated = await db
    .update(schema.users)
    .set({ firstLoginAt: now, updatedAt: now })
    .where(
      and(eq(schema.users.id, userId), isNull(schema.users.firstLoginAt)),
    )
    .returning({ id: schema.users.id });

  return updated.length > 0;
}
