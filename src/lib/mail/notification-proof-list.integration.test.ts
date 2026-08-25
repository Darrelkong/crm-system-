import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  createPendingNotificationIdentity,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import { enqueueNotificationProofForAdmin } from "@/lib/mail/notification-proof-enqueue-service";
import {
  assertNotificationProofRunResponseHasNoSecrets,
  listNotificationProofRunsForAdmin,
} from "@/lib/mail/notification-proof-list-service";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-phase2d1-proof-list";
const PROOF_USER = SEED_IDS.staffA;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailAdminPermission[],
  mailAccessEnabled = true,
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: "admin",
    mailAccessEnabled,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: FIXTURE },
  };
}

const superAdminActor = actor(PROOF_USER, ["super_admin"]);
const permissionMgmtActor = actor(PROOF_USER, ["permission_mgmt"]);

function fixtureEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@example.com`;
}

async function enableMailAccess(db: TestDb, userId: string) {
  const now = new Date().toISOString();
  await db
    .insert(schema.mailUserAccess)
    .values({
      userId,
      isEnabled: 1,
      enabledAt: now,
      enabledBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.mailUserAccess.userId,
      set: { isEnabled: 1, disabledAt: null, updatedAt: now },
    });
}

async function createVerifiedIdentity(db: TestDb, userId: string, email: string) {
  const permissionActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
  const capture = createCapturingNotificationVerificationChallengeSink();
  const pending = await createPendingNotificationIdentity(db, permissionActor, {
    targetUserId: userId,
    email,
    challengeSink: capture.sink,
  });
  const token = capture.latestToken();
  assert.ok(token);
  await verifyNotificationIdentity(db, permissionActor, {
    identityId: pending.id,
    token,
  });
}

async function cleanupFixtures(db: TestDb) {
  const outboxRows = await db
    .select({ id: schema.mailNotificationOutbox.id })
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.recipientUserId, PROOF_USER),
        eq(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
        ),
      ),
    );

  for (const row of outboxRows) {
    await db
      .delete(schema.mailNotificationAttempts)
      .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
  }

  await db
    .delete(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.recipientUserId, PROOF_USER),
        eq(
          schema.mailNotificationOutbox.sourceEntityType,
          MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
        ),
      ),
    );

  await db
    .delete(schema.mailNotificationIdentities)
    .where(
      and(
        eq(schema.mailNotificationIdentities.userId, PROOF_USER),
        like(schema.mailNotificationIdentities.email, `${FIXTURE}%`),
      ),
    );
}

describe("notification proof list service", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanupFixtures(db);
    await enableMailAccess(db, PROOF_USER);
    await createVerifiedIdentity(db, PROOF_USER, fixtureEmail("proof-list"));
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("rejects list without super_admin proof permission", async () => {
    await assert.rejects(
      () => listNotificationProofRunsForAdmin(db, permissionMgmtActor),
      (error: unknown) => {
        assert.ok(error instanceof MailServiceError);
        assert.equal(error.status, 403);
        return true;
      },
    );
  });

  it("lists self proof runs with safe fields only", async () => {
    const enqueued = await enqueueNotificationProofForAdmin(db, superAdminActor);
    const items = await listNotificationProofRunsForAdmin(db, superAdminActor);

    assert.ok(items.length >= 1);
    const run = items.find(
      (item) => item.sourceEntityId === enqueued.sourceEntityId,
    );
    assert.ok(run);
    assert.equal(run.notificationType, "new_incoming");
    assert.equal(run.outboxStatus, "pending");
    assert.equal(run.attemptStatus, null);
    assert.equal(run.providerId, null);
    assert.match(run.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    const payload = { items };
    assert.doesNotThrow(() => assertNotificationProofRunResponseHasNoSecrets(payload));
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /"email"/);
    assert.doesNotMatch(json, /verificationToken/);
    assert.doesNotMatch(json, /recipientUserId/);
    assert.doesNotMatch(json, /notificationIdentityId/);
  });

  it("includes latest attempt transport status when present", async () => {
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(
        and(
          eq(schema.mailNotificationOutbox.recipientUserId, PROOF_USER),
          eq(
            schema.mailNotificationOutbox.sourceEntityType,
            MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationProof,
          ),
        ),
      )
      .limit(1);
    assert.ok(outbox);

    await db.insert(schema.mailNotificationAttempts).values({
      id: crypto.randomUUID(),
      notificationOutboxId: outbox.id,
      attemptNumber: 1,
      processingVersion: outbox.processingVersion,
      state: "accepted",
      provider: "cloudflare-email-sending",
      providerRequestId: "provider-req-secret",
      startedAt: "2026-08-22T10:01:00.000Z",
      completedAt: "2026-08-22T10:01:05.000Z",
      errorCode: null,
      errorMessage: null,
    });

    const items = await listNotificationProofRunsForAdmin(db, superAdminActor);
    const run = items.find(
      (item) => item.sourceEntityId === outbox.sourceEntityId,
    );
    assert.ok(run);
    assert.equal(run.attemptStatus, "accepted");
    assert.equal(run.providerId, "cloudflare-email-sending");
    assert.equal(run.attemptCompletedAt, "2026-08-22T10:01:05.000Z");

    assert.doesNotThrow(() =>
      assertNotificationProofRunResponseHasNoSecrets({ items: [run] }),
    );
    assert.doesNotMatch(JSON.stringify(run), /provider-req-secret/);
  });
});
