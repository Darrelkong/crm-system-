import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";

const EXPIRABLE_TOKEN_STATES = ["prepared", "armed", "confirmed"] as const;

export type LargeAttachmentDeliveryTokenCleanupResult = {
  selected: number;
  expired: number;
  skipped: number;
};

export async function expireDueLargeAttachmentDeliveryTokens(
  db: Database,
  input: { trustNow: string; limit: number },
): Promise<LargeAttachmentDeliveryTokenCleanupResult> {
  const due = await db
    .select({
      id: schema.mailLargeAttachmentDeliveryTokens.id,
    })
    .from(schema.mailLargeAttachmentDeliveryTokens)
    .where(
      and(
        inArray(
          schema.mailLargeAttachmentDeliveryTokens.state,
          EXPIRABLE_TOKEN_STATES,
        ),
        lte(
          schema.mailLargeAttachmentDeliveryTokens.expiresAt,
          input.trustNow,
        ),
      ),
    )
    .orderBy(
      asc(schema.mailLargeAttachmentDeliveryTokens.expiresAt),
      asc(schema.mailLargeAttachmentDeliveryTokens.id),
    )
    .limit(Math.max(0, input.limit));

  let expired = 0;
  for (const token of due) {
    const updated = await db
      .update(schema.mailLargeAttachmentDeliveryTokens)
      .set({
        state: "expired",
        // 0075 requires armed_at for expired rows. A prepared row can only
        // survive if a prepare/arm batch was interrupted; keep its creation
        // timestamp as a forensic marker without changing expires_at.
        armedAt: sql`coalesce(${schema.mailLargeAttachmentDeliveryTokens.armedAt}, ${schema.mailLargeAttachmentDeliveryTokens.createdAt})`,
      })
      .where(
        and(
          eq(schema.mailLargeAttachmentDeliveryTokens.id, token.id),
          inArray(
            schema.mailLargeAttachmentDeliveryTokens.state,
            EXPIRABLE_TOKEN_STATES,
          ),
          lte(
            schema.mailLargeAttachmentDeliveryTokens.expiresAt,
            input.trustNow,
          ),
        ),
      )
      .returning({ id: schema.mailLargeAttachmentDeliveryTokens.id });
    if (updated.length === 1) {
      expired += 1;
    }
  }

  return {
    selected: due.length,
    expired,
    skipped: due.length - expired,
  };
}
