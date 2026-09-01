import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, isNull, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { resolveMailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { listAccessibleMailboxes } from "@/lib/mail/mail-read-mailbox-service";
import {
  disableMailAccess,
  enableMailAccess,
  prepareMailAccess,
} from "@/lib/mail/mail-access-service";
import {
  grantMailAdminPermission,
  revokeMailAdminGrant,
} from "@/lib/mail/mail-admin-grant-service";
import {
  buildVerifiedSwapPostStateAuditInsert,
  createPendingNotificationIdentity,
  findActiveVerifiedNotificationIdentity,
  findNotificationIdentityById,
  updateNotificationDeliveryHealth,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import { assertNotificationIdentityResponseHasNoSecrets } from "@/lib/mail/notification-identity-serialization";
import type { SafeNotificationIdentityAdminView } from "@/lib/mail/notification-identity-serialization";
import { runMailBatch } from "@/lib/mail/guarded-batch";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import { MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR } from "@/lib/mail/notification-verification-secret";

const FIXTURE = "mail-phase2c3";
const TARGET_USER = SEED_IDS.staffA;
const TEST_VERIFICATION_SECRET = "mail-phase2c3-integration-test-secret";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let baselineTargetAccess: typeof schema.mailUserAccess.$inferSelect | null =
  null;
let baselineTargetIdentities: typeof schema.mailNotificationIdentities.$inferSelect[] =
  [];

function actor(
  userId: string,
  grants: MailAdminPermission[] = ["permission_mgmt"],
  mailAccessEnabled = true,
  crmRole: "admin" | "staff" = "admin",
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole,
    mailAccessEnabled,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c3-test" },
  };
}

const permissionActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);
const readOnlyActor = actor(SEED_IDS.staffB, ["global_mail_read"], true, "staff");
const noGrantActor = actor(SEED_IDS.staffB, [], true, "staff");

function fixtureEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@gmail.com`;
}

async function createPendingWithTestToken(
  db: TestDb,
  actorCtx: MailActorContext,
  targetUserId: string,
  email: string,
): Promise<{ identity: SafeNotificationIdentityAdminView; token: string }> {
  const capture = createCapturingNotificationVerificationChallengeSink();
  const identity = await createPendingNotificationIdentity(db, actorCtx, {
    targetUserId,
    email,
    challengeSink: capture.sink,
  });
  const token = capture.latestToken();
  assert.ok(token, "test sink must capture verification token");
  return { identity, token };
}

async function ensureActorMailAccess(db: TestDb, userId: string) {
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
      set: { isEnabled: 1, updatedAt: now },
    });
}

async function cleanupFixtures(db: TestDb) {
  await db
    .delete(schema.auditLogs)
    .where(
      like(schema.auditLogs.entityId, `${FIXTURE}%`),
    );

  await db
    .delete(schema.mailNotificationIdentities)
    .where(
      and(
        eq(schema.mailNotificationIdentities.userId, TARGET_USER),
        like(schema.mailNotificationIdentities.email, `${FIXTURE}%`),
      ),
    );

  await db
    .delete(schema.mailAdminGrants)
    .where(
      and(
        eq(schema.mailAdminGrants.userId, TARGET_USER),
        like(schema.mailAdminGrants.id, `${FIXTURE}%`),
      ),
    );

  await db
    .delete(schema.mailAdminGrants)
    .where(
      and(
        eq(schema.mailAdminGrants.userId, TARGET_USER),
        eq(schema.mailAdminGrants.permission, "account_mgmt"),
      ),
    );

  if (baselineTargetAccess) {
    await db
      .update(schema.mailUserAccess)
      .set(baselineTargetAccess)
      .where(eq(schema.mailUserAccess.userId, TARGET_USER));
  } else {
    await db
      .delete(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, TARGET_USER));
  }
}

const PRESERVATION_MAILBOX_ID = `${FIXTURE}-mailbox`;
const PRESERVATION_THREAD_ID = `${FIXTURE}-thread`;
const PRESERVATION_MESSAGE_ID = `${FIXTURE}-message`;
const PRESERVATION_SENDER_IDENTITY_ID = `${FIXTURE}-sender`;
const PRESERVATION_SENDER_GRANT_ID = `${FIXTURE}-sender-grant`;
const PRESERVATION_MEMBER_ID = `${FIXTURE}-member`;

async function cleanupPreservationFixture(db: TestDb) {
  await db
    .delete(schema.mailSenderIdentityGrants)
    .where(eq(schema.mailSenderIdentityGrants.id, PRESERVATION_SENDER_GRANT_ID));
  await db
    .delete(schema.mailSenderIdentities)
    .where(eq(schema.mailSenderIdentities.id, PRESERVATION_SENDER_IDENTITY_ID));
  await db
    .delete(schema.mailMessageBodies)
    .where(eq(schema.mailMessageBodies.messageId, PRESERVATION_MESSAGE_ID));
  await db
    .delete(schema.mailMessages)
    .where(eq(schema.mailMessages.id, PRESERVATION_MESSAGE_ID));
  await db
    .delete(schema.mailThreads)
    .where(eq(schema.mailThreads.id, PRESERVATION_THREAD_ID));
  await db
    .delete(schema.mailMailboxMembers)
    .where(eq(schema.mailMailboxMembers.id, PRESERVATION_MEMBER_ID));
  await db
    .delete(schema.mailMailboxes)
    .where(eq(schema.mailMailboxes.id, PRESERVATION_MAILBOX_ID));
}

describe("mail access + notification identity integration", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const previousVerificationSecret =
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
      TEST_VERIFICATION_SECRET;
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    baselineTargetAccess =
      (await db
        .select()
        .from(schema.mailUserAccess)
        .where(eq(schema.mailUserAccess.userId, TARGET_USER))
        .limit(1))[0] ?? null;
    baselineTargetIdentities = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    if (baselineTargetIdentities.length > 0) {
      const snapshotAt = new Date().toISOString();
      await db
        .update(schema.mailNotificationIdentities)
        .set({
          verificationStatus: "revoked",
          revokedAt: snapshotAt,
          revokedBy: SEED_IDS.admin,
          revokeReason: "integration_test_snapshot",
          verificationTokenHash: null,
          verificationExpiresAt: null,
          updatedAt: snapshotAt,
        })
        .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    }
    await ensureActorMailAccess(db, SEED_IDS.admin);
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    for (const identity of baselineTargetIdentities) {
      await db
        .update(schema.mailNotificationIdentities)
        .set(identity)
        .where(eq(schema.mailNotificationIdentities.id, identity.id));
    }
    bindTestDatabase(null);
    dispose?.();
    if (previousVerificationSecret === undefined) {
      delete process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];
    } else {
      process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
        previousVerificationSecret;
    }
  });

  it("rejects enable without verified notification identity", async () => {
    await cleanupFixtures(db);
    await prepareMailAccess(db, permissionActor, TARGET_USER);
    const pending = await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("pending-only"),
    });
    assert.equal(pending.verificationStatus, "pending");

    await assert.rejects(
      () => enableMailAccess(db, permissionActor, TARGET_USER),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );

    await cleanupFixtures(db);
  });

  it("enables mail access after verified notification identity", async () => {
    await cleanupFixtures(db);
    await prepareMailAccess(db, permissionActor, TARGET_USER);
    const { identity: created, token } = await createPendingWithTestToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("verified-enable"),
    );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: created.id,
      token,
    });

    const enabled = await enableMailAccess(db, permissionActor, TARGET_USER);
    assert.equal(enabled.isEnabled, 1);
    assert.equal(enabled.hasVerifiedNotificationIdentity, true);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.accessEnabled));
    assert.ok(audits.some((row) => row.entityId === TARGET_USER));

    await cleanupFixtures(db);
  });

  it("delivery health changes do not disable mail or verification status", async () => {
    await cleanupFixtures(db);
    await prepareMailAccess(db, permissionActor, TARGET_USER);
    const { identity: created, token } = await createPendingWithTestToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("delivery-health"),
    );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: created.id,
      token,
    });
    await enableMailAccess(db, permissionActor, TARGET_USER);

    await updateNotificationDeliveryHealth(db, permissionActor, {
      identityId: created.id,
      deliveryHealth: "temporary_problem",
    });
    let access = await db
      .select()
      .from(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, TARGET_USER));
    let identity = await findNotificationIdentityById(db, created.id);
    assert.equal(access[0]?.isEnabled, 1);
    assert.equal(identity?.verificationStatus, "verified");

    await updateNotificationDeliveryHealth(db, permissionActor, {
      identityId: created.id,
      deliveryHealth: "bounced",
    });
    access = await db
      .select()
      .from(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, TARGET_USER));
    identity = await findNotificationIdentityById(db, created.id);
    assert.equal(access[0]?.isEnabled, 1);
    assert.equal(identity?.verificationStatus, "verified");

    await cleanupFixtures(db);
  });

  it("replacement pending coexists with verified until atomic verify", async () => {
    await cleanupFixtures(db);
    const { identity: oldCreated, token: oldToken } =
      await createPendingWithTestToken(
        db,
        permissionActor,
        TARGET_USER,
        fixtureEmail("old-verified"),
      );
    const oldVerified = await verifyNotificationIdentity(db, permissionActor, {
      identityId: oldCreated.id,
      token: oldToken,
    });
    assert.equal(oldVerified.verificationStatus, "verified");

    const { identity: newCreated, token: newToken } =
      await createPendingWithTestToken(
        db,
        permissionActor,
        TARGET_USER,
        fixtureEmail("new-pending"),
      );
    assert.equal(newCreated.verificationStatus, "pending");

    const oldAfterPending = await findNotificationIdentityById(
      db,
      oldVerified.id,
    );
    assert.equal(oldAfterPending?.verificationStatus, "verified");

    const promoted = await verifyNotificationIdentity(db, permissionActor, {
      identityId: newCreated.id,
      token: newToken,
    });
    assert.equal(promoted.verificationStatus, "verified");

    const oldAfterSwap = await findNotificationIdentityById(db, oldVerified.id);
    assert.equal(oldAfterSwap?.verificationStatus, "revoked");

    const verifiedRows = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(
        and(
          eq(schema.mailNotificationIdentities.userId, TARGET_USER),
          eq(schema.mailNotificationIdentities.verificationStatus, "verified"),
        ),
      );
    assert.equal(verifiedRows.length, 1);

    await cleanupFixtures(db);
  });

  it("failed notification identity swap rolls back verified state", async () => {
    await cleanupFixtures(db);
    const { identity: oldCreated, token: oldToken } =
      await createPendingWithTestToken(
        db,
        permissionActor,
        TARGET_USER,
        fixtureEmail("swap-old"),
      );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: oldCreated.id,
      token: oldToken,
    });
    const { identity: newCreated } = await createPendingWithTestToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("swap-new"),
    );

    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();

    await assert.rejects(async () => {
      await runMailBatch(db, [
        db
          .update(schema.mailNotificationIdentities)
          .set({
            verificationStatus: "revoked",
            revokedAt: now,
            revokedBy: SEED_IDS.admin,
            revokeReason: "test_rollback",
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.mailNotificationIdentities.id, oldCreated.id),
              eq(
                schema.mailNotificationIdentities.verificationStatus,
                "verified",
              ),
            ),
          ),
        db
          .update(schema.mailNotificationIdentities)
          .set({
            verificationStatus: "verified",
            verifiedAt: now,
            verificationTokenHash: null,
            verificationExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.mailNotificationIdentities.id, newCreated.id),
              eq(
                schema.mailNotificationIdentities.verificationStatus,
                "pending",
              ),
            ),
          ),
        buildVerifiedSwapPostStateAuditInsert(db, permissionActor, {
          auditId,
          now,
          action: MAIL_AUDIT_ACTIONS.notificationIdentityVerified,
          newIdentityId: "mail-phase2c3-missing-identity",
          targetUserId: TARGET_USER,
          metadata: { rollbackTest: true },
        }),
      ]);
    });

    const oldRow = await findNotificationIdentityById(db, oldCreated.id);
    const newRow = await findNotificationIdentityById(db, newCreated.id);
    assert.equal(oldRow?.verificationStatus, "verified");
    assert.equal(newRow?.verificationStatus, "pending");

    await cleanupFixtures(db);
  });

  it("permission management actor can grant and revoke ordinary grants", async () => {
    await cleanupFixtures(db);
    const grant = await grantMailAdminPermission(db, permissionActor, {
      targetUserId: TARGET_USER,
      permission: "account_mgmt",
    });
    assert.equal(grant.permission, "account_mgmt");

    const duplicate = await grantMailAdminPermission(db, permissionActor, {
      targetUserId: TARGET_USER,
      permission: "account_mgmt",
    });
    assert.equal(duplicate.id, grant.id);

    const revoked = await revokeMailAdminGrant(db, permissionActor, {
      grantId: grant.id,
    });
    assert.ok(revoked.revokedAt);

    await db
      .delete(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.id, grant.id));
    await cleanupFixtures(db);
  });

  it("global_mail_read actor cannot manage grants", async () => {
    await assert.rejects(
      () =>
        grantMailAdminPermission(db, readOnlyActor, {
          targetUserId: TARGET_USER,
          permission: "account_mgmt",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("crm admin without mail grant cannot manage access", async () => {
    await assert.rejects(
      () => enableMailAccess(db, noGrantActor, TARGET_USER),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("lower grant cannot create super_admin", async () => {
    await assert.rejects(
      () =>
        grantMailAdminPermission(db, permissionActor, {
          targetUserId: TARGET_USER,
          permission: "super_admin",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("super_admin can grant ordinary admin grants", async () => {
    await cleanupFixtures(db);
    const grant = await grantMailAdminPermission(db, superAdminActor, {
      targetUserId: TARGET_USER,
      permission: "address_assignment",
    });
    assert.equal(grant.permission, "address_assignment");
    await db
      .delete(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.id, grant.id));
    await cleanupFixtures(db);
  });

  it("enabled mail access does not imply admin grants", async () => {
    await cleanupFixtures(db);
    const { identity: created, token } = await createPendingWithTestToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("access-only"),
    );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: created.id,
      token,
    });
    await enableMailAccess(db, permissionActor, TARGET_USER);

    const grants = await db
      .select()
      .from(schema.mailAdminGrants)
      .where(
        and(
          eq(schema.mailAdminGrants.userId, TARGET_USER),
          isNull(schema.mailAdminGrants.revokedAt),
        ),
      );
    assert.equal(grants.length, 0);

    const verified = await findActiveVerifiedNotificationIdentity(
      db,
      TARGET_USER,
    );
    assert.ok(verified);

    await cleanupFixtures(db);
  });

  it("normalizes external notification email without company-domain restriction", async () => {
    await cleanupFixtures(db);
    const created = await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: `${FIXTURE}-Daniel.Notify+Mail@GMAIL.COM`,
    });
    assert.equal(created.email, `${FIXTURE}-daniel.notify+mail@gmail.com`);
    await cleanupFixtures(db);
  });

  it("disable mail access leaves notification identity intact", async () => {
    await cleanupFixtures(db);
    await cleanupPreservationFixture(db);
    const now = new Date().toISOString();
    await db.insert(schema.mailMailboxes).values({
      id: PRESERVATION_MAILBOX_ID,
      address: `${FIXTURE}-preserved@echfronthk.com`,
      displayName: "Preserved mailbox",
      mailboxType: "personal",
      status: "active",
      createdBy: TARGET_USER,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMailboxMembers).values({
      id: PRESERVATION_MEMBER_ID,
      mailboxId: PRESERVATION_MAILBOX_ID,
      userId: TARGET_USER,
      canRead: 1,
      canReply: 1,
      canSend: 1,
      grantedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailThreads).values({
      id: PRESERVATION_THREAD_ID,
      mailboxId: PRESERVATION_MAILBOX_ID,
      subjectNormalized: "preserved",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessages).values({
      id: PRESERVATION_MESSAGE_ID,
      threadId: PRESERVATION_THREAD_ID,
      mailboxId: PRESERVATION_MAILBOX_ID,
      direction: "inbound",
      fromAddress: "customer@example.com",
      subject: "Preserved history",
      previewText: "Preserved",
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailMessageBodies).values({
      messageId: PRESERVATION_MESSAGE_ID,
      bodyText: "History remains",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailSenderIdentities).values({
      id: PRESERVATION_SENDER_IDENTITY_ID,
      address: `${FIXTURE}-sender@echfronthk.com`,
      displayName: "Preserved sender",
      status: "active",
      defaultMailboxId: PRESERVATION_MAILBOX_ID,
      createdBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.mailSenderIdentityGrants).values({
      id: PRESERVATION_SENDER_GRANT_ID,
      senderIdentityId: PRESERVATION_SENDER_IDENTITY_ID,
      userId: TARGET_USER,
      canReply: 1,
      canSend: 1,
      grantedBy: SEED_IDS.admin,
      createdAt: now,
      updatedAt: now,
    });

    const { identity: created, token } = await createPendingWithTestToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("disable-access"),
    );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: created.id,
      token,
    });
    await enableMailAccess(db, permissionActor, TARGET_USER);
    await disableMailAccess(db, permissionActor, TARGET_USER);

    const identity = await findNotificationIdentityById(db, created.id);
    assert.equal(identity?.verificationStatus, "verified");
    const access = await db
      .select()
      .from(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, TARGET_USER));
    assert.equal(access[0]?.isEnabled, 0);
    assert.equal(
      (
        await db
          .select()
          .from(schema.mailMailboxes)
          .where(eq(schema.mailMailboxes.id, PRESERVATION_MAILBOX_ID))
      ).length,
      1,
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.mailMailboxMembers)
          .where(eq(schema.mailMailboxMembers.id, PRESERVATION_MEMBER_ID))
      ).length,
      1,
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.mailMessages)
          .where(eq(schema.mailMessages.id, PRESERVATION_MESSAGE_ID))
      ).length,
      1,
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.mailSenderIdentities)
          .where(eq(schema.mailSenderIdentities.id, PRESERVATION_SENDER_IDENTITY_ID))
      ).length,
      1,
    );

    const targetUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, TARGET_USER))
        .limit(1)
    )[0];
    assert.ok(targetUser);
    const liveStaffActor = await resolveMailActorContext(targetUser, { db });
    await assert.rejects(
      () => listAccessibleMailboxes(db, liveStaffActor),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "FORBIDDEN" &&
        error.message === "Mail access is not enabled for this user",
    );

    const reenabled = await enableMailAccess(db, permissionActor, TARGET_USER);
    assert.equal(reenabled.isEnabled, 1);
    const identityAfterReenable = await findNotificationIdentityById(
      db,
      created.id,
    );
    assert.equal(identityAfterReenable?.verificationStatus, "verified");
    assert.equal(identityAfterReenable?.revokedAt, null);

    await cleanupPreservationFixture(db);
    await cleanupFixtures(db);
  });

  it("create response contains no verification secrets", async () => {
    await cleanupFixtures(db);
    const capture = createCapturingNotificationVerificationChallengeSink();
    const item = await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("secret-safe"),
      challengeSink: capture.sink,
    });
    assert.ok(capture.latestToken());
    assert.doesNotThrow(() =>
      assertNotificationIdentityResponseHasNoSecrets({ item }),
    );
    assert.equal(item.verificationPending, true);
    await cleanupFixtures(db);
  });

  it("rejects reused verification token after success", async () => {
    await cleanupFixtures(db);
    const { identity, token } = await createPendingWithTestToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("reuse-token"),
    );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: identity.id,
      token,
    });
    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: identity.id,
          token,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );
    await cleanupFixtures(db);
  });

  it("rejects expired verification token", async () => {
    await cleanupFixtures(db);
    const { identity, token } = await createPendingWithTestToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("expired-token"),
    );
    await db
      .update(schema.mailNotificationIdentities)
      .set({
        verificationExpiresAt: "2000-01-01T00:00:00.000Z",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.mailNotificationIdentities.id, identity.id));

    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: identity.id,
          token,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );
    await cleanupFixtures(db);
  });

  it("wrong token does not swap verified replacement identity", async () => {
    await cleanupFixtures(db);
    const { identity: oldIdentity, token: oldToken } =
      await createPendingWithTestToken(
        db,
        permissionActor,
        TARGET_USER,
        fixtureEmail("wrong-old"),
      );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: oldIdentity.id,
      token: oldToken,
    });
    const { identity: newIdentity } = await createPendingWithTestToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("wrong-new"),
    );

    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: newIdentity.id,
          token: "0".repeat(64),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );

    const oldRow = await findNotificationIdentityById(db, oldIdentity.id);
    const newRow = await findNotificationIdentityById(db, newIdentity.id);
    assert.equal(oldRow?.verificationStatus, "verified");
    assert.equal(newRow?.verificationStatus, "pending");
    await cleanupFixtures(db);
  });

  it("runtime API cannot bootstrap first super_admin", async () => {
    await cleanupFixtures(db);
    await db
      .delete(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.permission, "super_admin"));

    await assert.rejects(
      () =>
        grantMailAdminPermission(db, superAdminActor, {
          targetUserId: TARGET_USER,
          permission: "super_admin",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
    await cleanupFixtures(db);
  });

  it("existing super_admin may grant another super_admin", async () => {
    await cleanupFixtures(db);
    const now = new Date().toISOString();
    const bootstrapGrantId = `${FIXTURE}-bootstrap-super-admin`;
    await db.insert(schema.mailAdminGrants).values({
      id: bootstrapGrantId,
      userId: SEED_IDS.admin,
      permission: "super_admin",
      grantedBy: SEED_IDS.admin,
      grantedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const grant = await grantMailAdminPermission(db, superAdminActor, {
      targetUserId: TARGET_USER,
      permission: "super_admin",
    });
    assert.equal(grant.permission, "super_admin");

    await db
      .delete(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.id, grant.id));
    await db
      .delete(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.id, bootstrapGrantId));
    await cleanupFixtures(db);
  });
});
