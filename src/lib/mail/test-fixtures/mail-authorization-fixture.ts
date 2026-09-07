import { eq } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import type { Database } from "@/lib/db";

const FIXTURE_TIME = "2026-01-01T00:00:00.000Z";

async function enableMailAccess(db: Database, userId: string): Promise<void> {
  await db
    .insert(schema.mailUserAccess)
    .values({
      userId,
      isEnabled: 1,
      enabledAt: FIXTURE_TIME,
      enabledBy: SEED_IDS.admin,
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
    })
    .onConflictDoUpdate({
      target: schema.mailUserAccess.userId,
      set: {
        isEnabled: 1,
        enabledAt: FIXTURE_TIME,
        enabledBy: SEED_IDS.admin,
        updatedAt: FIXTURE_TIME,
      },
    });
}

async function ensureVerifiedNotificationIdentity(
  db: Database,
  userId: string,
  suffix: string,
): Promise<void> {
  const id = `isolated-mail-notification-${suffix}`;
  const email = `${suffix}@isolated.test`;
  await db
    .insert(schema.mailNotificationIdentities)
    .values({
      id,
      userId,
      email,
      verificationStatus: "verified",
      verificationTokenHash: null,
      verificationRequestedAt: null,
      verificationExpiresAt: null,
      verificationAttemptCount: 0,
      verifiedAt: FIXTURE_TIME,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      deliveryHealth: "healthy",
      deliveryProblemAt: null,
      lastDeliveryStatus: "accepted",
      lastDeliveryAt: FIXTURE_TIME,
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
    })
    .onConflictDoUpdate({
      target: schema.mailNotificationIdentities.id,
      set: {
        userId,
        email,
        verificationStatus: "verified",
        verificationTokenHash: null,
        verificationRequestedAt: null,
        verificationExpiresAt: null,
        verificationAttemptCount: 0,
        verifiedAt: FIXTURE_TIME,
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
        deliveryHealth: "healthy",
        deliveryProblemAt: null,
        lastDeliveryStatus: "accepted",
        lastDeliveryAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME,
      },
    });
}

/**
 * Seeds only the database-backed Mail authorization prerequisites used by
 * integration tests. Mailbox and sender identity rows remain service-created
 * by each test, so production authorization paths are exercised unchanged.
 */
export async function ensureIsolatedMailAuthorizationFixture(
  db: Database,
): Promise<void> {
  await enableMailAccess(db, SEED_IDS.admin);
  await enableMailAccess(db, SEED_IDS.staffA);
  await enableMailAccess(db, SEED_IDS.staffB);
  await ensureVerifiedNotificationIdentity(db, SEED_IDS.staffA, "staff-a");
  await ensureVerifiedNotificationIdentity(db, SEED_IDS.staffB, "staff-b");

  const [adminAccess] = await db
    .select({ userId: schema.mailUserAccess.userId })
    .from(schema.mailUserAccess)
    .where(eq(schema.mailUserAccess.userId, SEED_IDS.admin))
    .limit(1);
  if (!adminAccess) {
    throw new Error("Isolated Mail authorization fixture was not created");
  }
}
