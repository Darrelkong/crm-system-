import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import {
  disableMailAccess,
  enableMailAccess,
} from "@/lib/mail/mail-access-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import {
  cancelPendingNotificationIdentity,
  configureNotificationIdentityEmail,
  createPendingNotificationIdentity,
  disableActiveNotificationIdentity,
  findActivePendingNotificationIdentity,
  findActiveVerifiedNotificationIdentity,
  findNotificationIdentityById,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import type { SafeNotificationIdentityAdminView } from "@/lib/mail/notification-identity-serialization";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import {
  MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR,
} from "@/lib/mail/notification-verification-secret";

const FIXTURE = "mail-phase1d1";
const TEST_VERIFICATION_SECRET = "mail-phase1d1-integration-test-secret";
const TARGET_USER = SEED_IDS.staffA;
const STAFF_SELF = SEED_IDS.staffA;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

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
    audit: { ipAddress: "127.0.0.1", userAgent: "phase1d1-test" },
  };
}

const adminActor = actor(SEED_IDS.admin, ["permission_mgmt"]);
const staffActor = actor(STAFF_SELF, [], true, "staff");

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
  assert.ok(token);
  return { identity, token };
}

async function cleanupFixtures(db: TestDb) {
  const outboxRows = await db
    .select({ id: schema.mailNotificationOutbox.id })
    .from(schema.mailNotificationOutbox)
    .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));

  for (const row of outboxRows) {
    await db
      .delete(schema.mailNotificationAttempts)
      .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
  }

  await db
    .delete(schema.mailNotificationOutbox)
    .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));

  await db
    .delete(schema.mailNotificationIdentities)
    .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));

  await db
    .update(schema.mailUserAccess)
    .set({ isEnabled: 0, disabledAt: new Date().toISOString() })
    .where(eq(schema.mailUserAccess.userId, TARGET_USER));
}

describe("notification identity lifecycle (phase 1D.1)", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const previousVerificationSecret =
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
      TEST_VERIFICATION_SECRET;
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "./wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    bindTestDatabase(null);
    dispose?.();
    if (previousVerificationSecret === undefined) {
      delete process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];
    } else {
      process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
        previousVerificationSecret;
    }
  });

  it("staff can configure own notification identity without admin grant", async () => {
    await cleanupFixtures(db);
    const created = await configureNotificationIdentityEmail(db, staffActor, {
      targetUserId: STAFF_SELF,
      email: fixtureEmail("self-add"),
    });
    assert.equal(created.verificationStatus, "pending");
    assert.equal(created.userId, STAFF_SELF);
    await cleanupFixtures(db);
  });

  it("staff cannot configure another user's notification identity", async () => {
    await assert.rejects(
      () =>
        configureNotificationIdentityEmail(db, staffActor, {
          targetUserId: SEED_IDS.staffB,
          email: fixtureEmail("staff-forbidden"),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("cancel replacement revokes pending only and preserves verified identity", async () => {
    await cleanupFixtures(db);
    const { identity: verified, token } = await createPendingWithTestToken(
      db,
      adminActor,
      TARGET_USER,
      fixtureEmail("keep-verified"),
    );
    await verifyNotificationIdentity(db, adminActor, {
      identityId: verified.id,
      token,
    });
    await configureNotificationIdentityEmail(db, adminActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("replacement"),
    });
    await cancelPendingNotificationIdentity(db, adminActor, TARGET_USER);

    const activeVerified = await findActiveVerifiedNotificationIdentity(
      db,
      TARGET_USER,
    );
    const activePending = await findActivePendingNotificationIdentity(
      db,
      TARGET_USER,
    );
    assert.ok(activeVerified);
    assert.equal(activeVerified.id, verified.id);
    assert.equal(activePending, null);
    await cleanupFixtures(db);
  });

  it("pending-only cancel leaves no active identity", async () => {
    await cleanupFixtures(db);
    await configureNotificationIdentityEmail(db, adminActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("pending-only"),
    });
    await cancelPendingNotificationIdentity(db, adminActor, TARGET_USER);
    assert.equal(
      await findActivePendingNotificationIdentity(db, TARGET_USER),
      null,
    );
    assert.equal(
      await findActiveVerifiedNotificationIdentity(db, TARGET_USER),
      null,
    );
    await cleanupFixtures(db);
  });

  it("disable verified identity revokes identities and disables mail access", async () => {
    await cleanupFixtures(db);
    const { identity, token } = await createPendingWithTestToken(
      db,
      adminActor,
      TARGET_USER,
      fixtureEmail("disable-me"),
    );
    await verifyNotificationIdentity(db, adminActor, {
      identityId: identity.id,
      token,
    });
    await enableMailAccess(db, adminActor, TARGET_USER);
    await disableActiveNotificationIdentity(db, adminActor, TARGET_USER);

    const access = await db
      .select()
      .from(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, TARGET_USER))
      .limit(1);
    assert.equal(access[0]?.isEnabled, 0);
    assert.equal(
      await findActiveVerifiedNotificationIdentity(db, TARGET_USER),
      null,
    );

    const revoked = await findNotificationIdentityById(db, identity.id);
    assert.equal(revoked?.verificationStatus, "revoked");
    assert.equal(revoked?.revokeReason, "notification_identity_disabled");
    await cleanupFixtures(db);
  });

  it("disable preserves mailbox records", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, adminActor, {
      address: `${FIXTURE}-work-${crypto.randomUUID().slice(0, 8)}@echfronthk.com`,
      displayName: "Work mailbox",
      mailboxType: "personal",
      ownerUserId: TARGET_USER,
    });
    const { identity, token } = await createPendingWithTestToken(
      db,
      adminActor,
      TARGET_USER,
      fixtureEmail("mailbox-keep"),
    );
    await verifyNotificationIdentity(db, adminActor, {
      identityId: identity.id,
      token,
    });
    await enableMailAccess(db, adminActor, TARGET_USER);
    await disableActiveNotificationIdentity(db, adminActor, TARGET_USER);

    const mailboxAfter = await db
      .select()
      .from(schema.mailMailboxes)
      .where(eq(schema.mailMailboxes.id, mailbox.id))
      .limit(1);
    assert.equal(mailboxAfter[0]?.address, mailbox.address);
    assert.equal(mailboxAfter[0]?.status, mailbox.status);
    await cleanupFixtures(db);
  });

  it("replacement pending keeps mail access enabled until disable", async () => {
    await cleanupFixtures(db);
    const { identity, token } = await createPendingWithTestToken(
      db,
      adminActor,
      TARGET_USER,
      fixtureEmail("access-old"),
    );
    await verifyNotificationIdentity(db, adminActor, {
      identityId: identity.id,
      token,
    });
    await enableMailAccess(db, adminActor, TARGET_USER);
    await configureNotificationIdentityEmail(db, adminActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("access-new"),
    });

    const access = await db
      .select()
      .from(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, TARGET_USER))
      .limit(1);
    assert.equal(access[0]?.isEnabled, 1);
    await cleanupFixtures(db);
  });

  it("configure with existing replacement pending is rejected", async () => {
    await cleanupFixtures(db);
    const { identity, token } = await createPendingWithTestToken(
      db,
      adminActor,
      TARGET_USER,
      fixtureEmail("dup-old"),
    );
    await verifyNotificationIdentity(db, adminActor, {
      identityId: identity.id,
      token,
    });
    await configureNotificationIdentityEmail(db, adminActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("dup-new"),
    });
    await assert.rejects(
      () =>
        configureNotificationIdentityEmail(db, adminActor, {
          targetUserId: TARGET_USER,
          email: fixtureEmail("dup-another"),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );
    await cleanupFixtures(db);
  });

  it("records pending cancellation audit action", async () => {
    await cleanupFixtures(db);
    await configureNotificationIdentityEmail(db, adminActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("audit-cancel"),
    });
    await cancelPendingNotificationIdentity(db, adminActor, TARGET_USER);
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.userId, adminActor.userId),
          eq(
            schema.auditLogs.action,
            MAIL_AUDIT_ACTIONS.notificationIdentityPendingCancelled,
          ),
        ),
      );
    assert.ok(audits.length >= 1);
    await cleanupFixtures(db);
  });
});
