import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { enableMailAccess } from "@/lib/mail/mail-access-service";
import {
  createPendingNotificationIdentity,
  sendNotificationIdentityVerificationChallenge,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { assertNotificationIdentityResponseHasNoSecrets } from "@/lib/mail/notification-identity-serialization";
import { createCapturingNotificationVerificationChallengeSink } from "@/lib/mail/notification-verification-challenge-sink";
import { NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS } from "@/lib/mail/notification-verification-challenge-policy";
import {
  assertNotificationVerificationProofTokenApiAllowed,
} from "@/lib/mail/notification-verification-proof-guard";
import { hashVerificationToken } from "@/lib/mail/verification-token";
import {
  MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR,
} from "@/lib/mail/notification-verification-secret";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-phase2h-6j2-security";
const TARGET_USER = SEED_IDS.staffA;
const OTHER_USER = SEED_IDS.staffB;

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailAdminPermission[] = ["permission_mgmt"],
  crmRole: "admin" | "staff" = "staff",
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole,
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: FIXTURE },
  };
}

const rootAdminActor = actor(SEED_IDS.admin, ["permission_mgmt"], "admin");
const permissionActor = actor(SEED_IDS.staffB, ["permission_mgmt"]);
const staffActor = actor(TARGET_USER, []);
const delegatedNoGrantActor = actor(SEED_IDS.staffB, []);

function fixtureEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@example.com`;
}

async function cleanupFixtures(db: TestDb) {
  for (const userId of [TARGET_USER, OTHER_USER, SEED_IDS.staffB]) {
    const outboxRows = await db
      .select({ id: schema.mailNotificationOutbox.id })
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, userId));
    for (const row of outboxRows) {
      await db
        .delete(schema.mailNotificationAttempts)
        .where(eq(schema.mailNotificationAttempts.notificationOutboxId, row.id));
    }
    await db
      .delete(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, userId));
    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.userId, userId));
    await db
      .delete(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, userId));
    await db
      .delete(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, userId));
  }
}

async function createAndSendVerificationToken(
  db: TestDb,
  actorCtx: MailActorContext,
  targetUserId: string,
  email: string,
) {
  await createPendingNotificationIdentity(db, actorCtx, {
    targetUserId,
    email,
  });
  const capture = createCapturingNotificationVerificationChallengeSink();
  const sent = await sendNotificationIdentityVerificationChallenge(
    db,
    actorCtx,
    targetUserId,
    { challengeSink: capture.sink },
  );
  const token = capture.latestToken();
  assert.ok(token, "test sink must capture verification token");
  return { sent, token };
}

describe("notification identity verification security", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const previousTestDbBind = process.env.CRM_ALLOW_TEST_DB_BIND;

  const previousVerificationSecret =
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
      "notification-verification-security-integration-secret";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanupFixtures(db);
  });

  beforeEach(async () => {
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
    if (previousTestDbBind === undefined) {
      delete process.env.CRM_ALLOW_TEST_DB_BIND;
    } else {
      process.env.CRM_ALLOW_TEST_DB_BIND = previousTestDbBind;
    }
    if (previousVerificationSecret === undefined) {
      delete process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR];
    } else {
      process.env[MAIL_NOTIFICATION_VERIFICATION_SECRET_VAR] =
        previousVerificationSecret;
    }
  });

  it("allows root admin to create pending target identity", async () => {
    const created = await createPendingNotificationIdentity(db, rootAdminActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("create"),
    });
    assert.equal(created.userId, TARGET_USER);
    assert.equal(created.verificationStatus, "pending");
  });

  it("does not expose raw challenge in create response", async () => {
    const created = await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("no-secret-create"),
    });
    assert.doesNotThrow(() =>
      assertNotificationIdentityResponseHasNoSecrets({ item: created }),
    );
  });

  it("does not expose raw challenge in send response", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("no-secret-send"),
    });
    const sent = await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
      { challengeSink: createCapturingNotificationVerificationChallengeSink().sink },
    );
    assert.doesNotThrow(() =>
      assertNotificationIdentityResponseHasNoSecrets({ item: sent.item }),
    );
    assert.equal(
      (sent as Record<string, unknown>).verificationToken,
      undefined,
    );
  });

  it("blocks production-capable target raw token route surface", () => {
    assert.equal(
      existsSync(
        "src/app/api/mail/access/[userId]/notification-identities/issue-verification-token/route.ts",
      ),
      false,
    );
    const sendRoute = readFileSync(
      "src/app/api/mail/access/[userId]/notification-identities/send-verification/route.ts",
      "utf8",
    );
    assert.match(sendRoute, /sendNotificationIdentityVerificationChallenge/);
    assert.doesNotMatch(sendRoute, /verificationToken/);
  });

  it("rejects staff without authority from creating target identity", async () => {
    await assert.rejects(
      () =>
        createPendingNotificationIdentity(db, staffActor, {
          targetUserId: OTHER_USER,
          email: fixtureEmail("staff-forbidden"),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
  });

  it("delivers challenge only to the configured external email", async () => {
    const email = fixtureEmail("destination");
    const capture = createCapturingNotificationVerificationChallengeSink();
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    await sendNotificationIdentityVerificationChallenge(db, permissionActor, TARGET_USER, {
      challengeSink: capture.sink,
    });
    assert.equal(capture.deliveries.length, 1);
    assert.equal(capture.deliveries[0]?.targetEmail, email);
  });

  it("persists hash but not plaintext challenge", async () => {
    const { token, sent } = await createAndSendVerificationToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("hash-only"),
    );
    const [row] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.id, sent.item.id))
      .limit(1);
    assert.ok(row?.verificationTokenHash);
    assert.equal(
      row.verificationTokenHash,
      hashVerificationToken(token, sent.item.id),
    );
    assert.notEqual(row.verificationTokenHash, token);
  });

  it("rejects wrong verification code", async () => {
    const { sent } = await createAndSendVerificationToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("wrong-code"),
    );
    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: sent.item.id,
          token: "ABCDEFGH",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("rejects expired verification code", async () => {
    const { token, sent } = await createAndSendVerificationToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("expired"),
    );
    await db
      .update(schema.mailNotificationIdentities)
      .set({ verificationExpiresAt: "2000-01-01T00:00:00.000Z" })
      .where(eq(schema.mailNotificationIdentities.id, sent.item.id));
    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: sent.item.id,
          token,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 409,
    );
  });

  it("rejects reused verification code", async () => {
    const { token, sent } = await createAndSendVerificationToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("reuse"),
    );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: sent.item.id,
      token,
    });
    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: sent.item.id,
          token,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 409,
    );
  });

  it("rejects cross-identity verification code", async () => {
    const first = await createAndSendVerificationToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("cross-a"),
    );
    const second = await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: OTHER_USER,
      email: fixtureEmail("cross-b"),
    });
    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: second.id,
          token: first.token,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("invalidates previous code after resend rotation", async () => {
    const email = fixtureEmail("rotate");
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    const firstCapture = createCapturingNotificationVerificationChallengeSink();
    const firstNowMs = Date.now();
    await sendNotificationIdentityVerificationChallenge(db, permissionActor, TARGET_USER, {
      challengeSink: firstCapture.sink,
      nowMs: firstNowMs,
    });
    const firstToken = firstCapture.latestToken();
    assert.ok(firstToken);

    const secondCapture = createCapturingNotificationVerificationChallengeSink();
    await sendNotificationIdentityVerificationChallenge(db, permissionActor, TARGET_USER, {
      challengeSink: secondCapture.sink,
      nowMs: firstNowMs + NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS + 1_000,
    });
    const secondToken = secondCapture.latestToken();
    assert.ok(secondToken);

    const [identity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER))
      .limit(1);
    assert.ok(identity);

    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: identity.id,
          token: firstToken,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );

    const verified = await verifyNotificationIdentity(db, permissionActor, {
      identityId: identity.id,
      token: secondToken,
    });
    assert.equal(verified.verificationStatus, "verified");
  });

  it("returns transport_disabled without pretending delivery when transport is off", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("transport-off"),
    });
    const result = await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
    );
    assert.equal(result.delivery.status, "transport_disabled");
    assert.equal(result.delivery.destinationEmail, fixtureEmail("transport-off"));
  });

  it("enforces deterministic send rate limit", async () => {
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email: fixtureEmail("rate-limit"),
    });
    const capture = createCapturingNotificationVerificationChallengeSink();
    const baseNowMs = Date.now();
    for (let i = 0; i < 3; i += 1) {
      await sendNotificationIdentityVerificationChallenge(db, permissionActor, TARGET_USER, {
        challengeSink: capture.sink,
        nowMs: baseNowMs + i * (NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS + 1_000),
      });
    }
    await assert.rejects(
      () =>
        sendNotificationIdentityVerificationChallenge(db, permissionActor, TARGET_USER, {
          challengeSink: capture.sink,
          nowMs: baseNowMs + 3 * (NOTIFICATION_VERIFICATION_RESEND_COOLDOWN_MS + 1_000),
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 409,
    );
  });

  it("allows enableMailAccess only after verified identity", async () => {
    const { token, sent } = await createAndSendVerificationToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("enable"),
    );
    await assert.rejects(
      () => enableMailAccess(db, permissionActor, TARGET_USER),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: sent.item.id,
      token,
    });
    const enabled = await enableMailAccess(db, permissionActor, TARGET_USER);
    assert.equal(enabled.isEnabled, 1);
  });

  it("does not auto-create mailbox, sender identity, or grants on enable", async () => {
    const { token, sent } = await createAndSendVerificationToken(
      db,
      permissionActor,
      TARGET_USER,
      fixtureEmail("no-auto"),
    );
    const adminGrantsBefore = await db
      .select()
      .from(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.userId, TARGET_USER));
    const senderGrantsBefore = await db
      .select()
      .from(schema.mailSenderIdentityGrants)
      .where(eq(schema.mailSenderIdentityGrants.userId, TARGET_USER));
    const mailboxesBefore = await db.select().from(schema.mailMailboxes);

    await verifyNotificationIdentity(db, permissionActor, {
      identityId: sent.item.id,
      token,
    });
    await enableMailAccess(db, permissionActor, TARGET_USER);

    const adminGrantsAfter = await db
      .select()
      .from(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.userId, TARGET_USER));
    const senderGrantsAfter = await db
      .select()
      .from(schema.mailSenderIdentityGrants)
      .where(eq(schema.mailSenderIdentityGrants.userId, TARGET_USER));
    const mailboxesAfter = await db.select().from(schema.mailMailboxes);

    assert.equal(adminGrantsAfter.length, adminGrantsBefore.length);
    assert.equal(senderGrantsAfter.length, senderGrantsBefore.length);
    assert.equal(mailboxesAfter.length, mailboxesBefore.length);
  });

  it("allows local proof-token API guard only in test bind context", () => {
    assert.doesNotThrow(() => assertNotificationVerificationProofTokenApiAllowed());
    const previous = process.env.CRM_ALLOW_TEST_DB_BIND;
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    assert.throws(() => assertNotificationVerificationProofTokenApiAllowed());
    process.env.CRM_ALLOW_TEST_DB_BIND = previous;
  });
});
