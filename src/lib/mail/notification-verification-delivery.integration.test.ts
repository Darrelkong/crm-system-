import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS,
} from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { MailServiceError } from "@/lib/mail/errors";
import { enableMailAccess } from "@/lib/mail/mail-access-service";
import { MemoryInboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import { MemoryInboundRawPayloadStore } from "@/lib/mail/inbound-raw-payload-store";
import {
  listDueGeneralNotificationOutboxEvents,
  listDueVerificationNotificationOutboxEvents,
} from "@/lib/mail/mail-background-due-work-queries";
import { runMailBackgroundTick } from "@/lib/mail/mail-background-tick-service";
import { enqueueMailNotificationIntent } from "@/lib/mail/notification-outbox-enqueue-service";
import {
  claimNotificationOutboxForProcessing,
  findNotificationOutboxById,
  processClaimedNotificationOutbox,
} from "@/lib/mail/notification-outbox-processing-service";
import {
  createPendingNotificationIdentity,
  revokeNotificationIdentity,
  sendNotificationIdentityVerificationChallenge,
  verifyNotificationIdentity,
} from "@/lib/mail/notification-identity-service";
import { assertNotificationIdentityResponseHasNoSecrets } from "@/lib/mail/notification-identity-serialization";
import { MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES } from "@/lib/mail/notification-source-entity-policy";
import { VERIFICATION_OUTBOX_NOTIFICATION_TYPE } from "@/lib/mail/notification-verification-enqueue-service";
import {
  assertNotificationVerificationProofTokenApiAllowed,
} from "@/lib/mail/notification-verification-proof-guard";
import {
  createCapturingNotificationVerificationChallengeSink,
  type NotificationVerificationChallengeSink,
} from "@/lib/mail/notification-verification-challenge-sink";
import {
  processClaimedVerificationOutboxDelivery,
  VERIFICATION_OUTBOX_FAILURE_CODES,
} from "@/lib/mail/notification-verification-outbox-processing-service";
import {
  MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR,
} from "@/lib/mail/notification-verification-transport";
import { buildNotificationVerificationEmailContent } from "@/lib/mail/notification-verification-email";
import { FakeNotificationTransportAdapter } from "@/lib/mail/notification-transport-adapter";
import { listNotificationProofRunsForAdmin } from "@/lib/mail/notification-proof-list-service";
import { resolveMailOutboundTransportMode } from "@/lib/mail/outbound-transport-constants";
import {
  setNotificationProcessingLeaseTestClock,
} from "@/lib/mail/notification-processing-lease";
import { SYSTEM_MAIL_ACTOR } from "@/lib/mail/system-mail-actor";
import {
  hashVerificationToken,
  verificationExpiresAt,
} from "@/lib/mail/verification-token";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-phase2h-6j3-delivery";
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

const permissionActor = actor(SEED_IDS.staffB, ["permission_mgmt"]);
const rootAdminActor = actor(SEED_IDS.admin, ["permission_mgmt"], "admin");

function fixtureEmail(localPart: string): string {
  return `${FIXTURE}-${localPart}@example.com`;
}

function createFailingVerificationSink(): NotificationVerificationChallengeSink {
  return {
    async deliverChallenge() {
      throw new Error("simulated provider temporary failure");
    },
  };
}

async function cleanupFixtures(db: TestDb) {
  for (const userId of [TARGET_USER, OTHER_USER, SEED_IDS.staffB, SEED_IDS.admin]) {
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

async function enableMailAccessForTest(db: TestDb, userId: string) {
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

async function createVerifiedIdentity(
  db: TestDb,
  userId: string,
  email: string,
): Promise<string> {
  const capture = createCapturingNotificationVerificationChallengeSink();
  const pending = await createPendingNotificationIdentity(db, permissionActor, {
    targetUserId: userId,
    email,
    challengeSink: capture.sink,
  });
  const token = capture.latestToken();
  assert.ok(token);
  const verified = await verifyNotificationIdentity(db, permissionActor, {
    identityId: pending.id,
    token,
  });
  return verified.id;
}

async function queueVerificationSend(
  db: TestDb,
  targetUserId: string,
  email: string,
) {
  await createPendingNotificationIdentity(db, permissionActor, {
    targetUserId,
    email,
  });
  return sendNotificationIdentityVerificationChallenge(
    db,
    permissionActor,
    targetUserId,
  );
}

async function dispatchVerificationOutbox(
  db: TestDb,
  outboxId: string,
  sink: NotificationVerificationChallengeSink,
) {
  const claim = await claimNotificationOutboxForProcessing(db, { outboxId });
  assert.equal(claim.claimed, true);
  return processClaimedVerificationOutboxDelivery(db, SYSTEM_MAIL_ACTOR, {
    outboxId,
    sink,
  });
}

describe("notification verification delivery (6J.3)", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const previousTestDbBind = process.env.CRM_ALLOW_TEST_DB_BIND;
  const previousVerificationMode =
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR];
  const previousGeneralTransport = process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: "./wrangler.jsonc",
      persist: { path: ".wrangler/state/v3" },
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = previousTestDbBind;
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] =
      previousVerificationMode;
    process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED = previousGeneralTransport;
    dispose?.();
  });

  beforeEach(async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "disabled";
    process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED = "false";
    await cleanupFixtures(db);
  });

  afterEach(async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] =
      previousVerificationMode;
    process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED = previousGeneralTransport;
  });

  it("1. send-verification API exposes no raw token", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("no-raw-token");
    const result = await queueVerificationSend(db, TARGET_USER, email);
    assertNotificationIdentityResponseHasNoSecrets(result);
    assert.equal(result.delivery.status, "queued");
    assert.equal(result.delivery.destinationEmail, email);
    assert.equal(JSON.stringify(result).includes("verificationToken"), false);
  });

  it("2. production target raw token route remains deleted", () => {
    const deletedRoute =
      "src/app/api/mail/access/[userId]/notification-identities/issue-verification-token/route.ts";
    assert.equal(existsSync(deletedRoute), false);
  });

  it("3. self proof-token API remains LOCAL_ONLY", () => {
    const previousBind = process.env.CRM_ALLOW_TEST_DB_BIND;
    delete process.env.CRM_ALLOW_TEST_DB_BIND;
    try {
      assert.throws(
        () => assertNotificationVerificationProofTokenApiAllowed(),
        (error: unknown) =>
          error instanceof MailServiceError && error.status === 404,
      );
    } finally {
      process.env.CRM_ALLOW_TEST_DB_BIND = previousBind;
    }
  });

  it("4. send request creates verification outbox work correctly", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("outbox-create");
    await queueVerificationSend(db, TARGET_USER, email);

    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    assert.ok(outbox);
    assert.equal(outbox.notificationType, VERIFICATION_OUTBOX_NOTIFICATION_TYPE);
    assert.equal(
      outbox.sourceEntityType,
      MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailNotificationIdentityVerification,
    );
    assert.equal(outbox.status, "pending");
  });

  it("5. destination resolves only to target Notification Identity email", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("destination");
    const queued = await queueVerificationSend(db, TARGET_USER, email);
    assert.equal(queued.delivery.destinationEmail, email);

    const capture = createCapturingNotificationVerificationChallengeSink();
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    await dispatchVerificationOutbox(db, outbox!.id, capture.sink);
    assert.equal(capture.deliveries.at(-1)?.targetEmail, email);
  });

  it("6. wrong target user association rejected", async () => {
    await assert.rejects(
      () =>
        sendNotificationIdentityVerificationChallenge(
          db,
          permissionActor,
          "missing-user-id",
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("7. revoked identity rejected safely", async () => {
    const email = fixtureEmail("revoked");
    const pending = await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    await revokeNotificationIdentity(db, permissionActor, {
      identityId: pending.id,
    });
    await assert.rejects(
      () =>
        sendNotificationIdentityVerificationChallenge(
          db,
          permissionActor,
          TARGET_USER,
          { challengeSink: createCapturingNotificationVerificationChallengeSink().sink },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("8. already-verified identity rejects send", async () => {
    const email = fixtureEmail("verified-send");
    await createVerifiedIdentity(db, TARGET_USER, email);
    await assert.rejects(
      () =>
        sendNotificationIdentityVerificationChallenge(
          db,
          permissionActor,
          TARGET_USER,
          { challengeSink: createCapturingNotificationVerificationChallengeSink().sink },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("9. raw challenge is NOT stored in outbox rows", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("no-outbox-plaintext");
    await queueVerificationSend(db, TARGET_USER, email);
    const capture = createCapturingNotificationVerificationChallengeSink();
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    await dispatchVerificationOutbox(db, outbox!.id, capture.sink);
    const token = capture.latestToken();
    assert.ok(token);
    const json = JSON.stringify(outbox);
    assert.equal(json.includes(token), false);
  });

  it("10. raw challenge is NOT stored in audit rows", async () => {
    const capture = createCapturingNotificationVerificationChallengeSink();
    const email = fixtureEmail("no-audit-plaintext");
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
      { challengeSink: capture.sink },
    );
    const token = capture.latestToken();
    assert.ok(token);
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.userId, permissionActor.userId));
    const auditJson = JSON.stringify(audits);
    assert.equal(auditJson.includes(token), false);
    assert.equal(auditJson.includes("verificationToken"), false);
  });

  it("11. worker generates raw challenge at dispatch (MODEL B)", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("model-b");
    await queueVerificationSend(db, TARGET_USER, email);
    const capture = createCapturingNotificationVerificationChallengeSink();
    assert.equal(capture.deliveries.length, 0);

    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    await dispatchVerificationOutbox(db, outbox!.id, capture.sink);
    const token = capture.latestToken();
    assert.ok(token);
  });

  it("12. challenge hash is persisted correctly at dispatch", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("hash");
    await queueVerificationSend(db, TARGET_USER, email);
    const capture = createCapturingNotificationVerificationChallengeSink();
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    await dispatchVerificationOutbox(db, outbox!.id, capture.sink);
    const token = capture.latestToken();
    assert.ok(token);
    const [identity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    assert.equal(identity!.verificationTokenHash, hashVerificationToken(token));
  });

  it("13. expiry begins at dispatch time", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("expiry");
    await queueVerificationSend(db, TARGET_USER, email);
    const [before] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    const createExpiry = before!.verificationExpiresAt;
    assert.ok(createExpiry);

    const beforeDispatch = Date.now();
    const capture = createCapturingNotificationVerificationChallengeSink();
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    await dispatchVerificationOutbox(db, outbox!.id, capture.sink);
    const afterDispatch = Date.now();

    const [after] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    assert.ok(after!.verificationExpiresAt);
    const expiresMs = Date.parse(after!.verificationExpiresAt!);
    assert.ok(expiresMs >= beforeDispatch);
    assert.ok(expiresMs <= afterDispatch + 24 * 60 * 60 * 1000 + 5000);
    assert.notEqual(after!.verificationExpiresAt, createExpiry);
  });

  it("14. verification email contains the generated challenge", async () => {
    const capture = createCapturingNotificationVerificationChallengeSink();
    const email = fixtureEmail("email-content");
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
      { challengeSink: capture.sink },
    );
    const delivery = capture.deliveries.at(-1)!;
    const content = buildNotificationVerificationEmailContent({
      targetEmail: delivery.targetEmail,
      verificationCode: delivery.token,
      expiresAt: delivery.expiresAt,
    });
    assert.ok(content.text.includes(delivery.token));
  });

  it("15. approved sender is the system notification sender", () => {
    const content = buildNotificationVerificationEmailContent({
      targetEmail: fixtureEmail("sender"),
      verificationCode: "abc123",
      expiresAt: verificationExpiresAt(),
    });
    assert.ok(content.from.includes(CLOUDFLARE_EMAIL_NOTIFICATION_FROM_ADDRESS));
  });

  it("16. successful delivery records sent outbox and delivery audit", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("sent-state");
    await queueVerificationSend(db, TARGET_USER, email);
    const capture = createCapturingNotificationVerificationChallengeSink();
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    const processed = await dispatchVerificationOutbox(db, outbox!.id, capture.sink);
    assert.equal(processed.outcome, "sent");
    const refreshed = await findNotificationOutboxById(db, outbox!.id);
    assert.equal(refreshed!.status, "sent");
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        eq(
          schema.auditLogs.action,
          MAIL_AUDIT_ACTIONS.notificationIdentityVerificationDeliveryAccepted,
        ),
      );
    assert.ok(audits.length >= 1);
  });

  it("17. failed provider delivery leaves identity UNVERIFIED", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("provider-fail");
    await queueVerificationSend(db, TARGET_USER, email);
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    const processed = await dispatchVerificationOutbox(
      db,
      outbox!.id,
      createFailingVerificationSink(),
    );
    assert.equal(processed.outcome, "failed_retryable");
    const [identity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    assert.equal(identity!.verificationStatus, "pending");
  });

  it("18. retry remains idempotent after transient failure", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("retry");
    await queueVerificationSend(db, TARGET_USER, email);
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    await dispatchVerificationOutbox(
      db,
      outbox!.id,
      createFailingVerificationSink(),
    );
    const refreshed = await findNotificationOutboxById(db, outbox!.id);
    assert.equal(refreshed!.status, "failed_retryable");
    assert.ok(refreshed!.nextAttemptAt);
    setNotificationProcessingLeaseTestClock(refreshed!.nextAttemptAt!);

    const capture = createCapturingNotificationVerificationChallengeSink();
    const retry = await dispatchVerificationOutbox(db, outbox!.id, capture.sink);
    setNotificationProcessingLeaseTestClock(null);
    assert.equal(retry.outcome, "sent");
    const token = capture.latestToken();
    assert.ok(token);
    const verified = await verifyNotificationIdentity(db, permissionActor, {
      identityId: outbox!.notificationIdentityId,
      token,
    });
    assert.equal(verified.verificationStatus, "verified");
  });

  it("19. resend invalidates older queued challenge", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("resend");
    await queueVerificationSend(db, TARGET_USER, email);
    const [firstOutbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
    );
    const capture = createCapturingNotificationVerificationChallengeSink();
    const firstResult = await dispatchVerificationOutbox(
      db,
      firstOutbox!.id,
      capture.sink,
    );
    assert.equal(firstResult.outcome, "skipped");
    assert.equal(
      firstResult.failureCode,
      VERIFICATION_OUTBOX_FAILURE_CODES.superseded,
    );
  });

  it("20. late worker cannot restore superseded challenge", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("race");
    await queueVerificationSend(db, TARGET_USER, email);
    const [firstOutbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
    );
    const outboxes = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER))
      .orderBy(schema.mailNotificationOutbox.enqueuedAt);
    assert.equal(outboxes.length, 2);
    const secondOutbox = outboxes[1]!;
    const secondCapture = createCapturingNotificationVerificationChallengeSink();
    await dispatchVerificationOutbox(db, secondOutbox.id, secondCapture.sink);
    const secondToken = secondCapture.latestToken();
    assert.ok(secondToken);

    const firstCapture = createCapturingNotificationVerificationChallengeSink();
    const late = await dispatchVerificationOutbox(
      db,
      firstOutbox!.id,
      firstCapture.sink,
    );
    assert.equal(late.outcome, "skipped");
    assert.equal(firstCapture.deliveries.length, 0);

    const [identity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    assert.equal(
      identity!.verificationTokenHash,
      hashVerificationToken(secondToken),
    );
    await assert.rejects(
      () =>
        verifyNotificationIdentity(db, permissionActor, {
          identityId: identity!.id,
          token: firstCapture.latestToken() ?? "0000",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("21. verification mode disabled skips verification dispatch", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("mode-off");
    await queueVerificationSend(db, TARGET_USER, email);
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "disabled";
    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: new MemoryInboundRawPayloadStore(),
      attachmentStore: new MemoryInboundAttachmentStore(),
    });
    assert.equal(summary.verificationDispatchSkipped, true);
    assert.equal(summary.verificationDispatch.selected, 0);
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    assert.equal(outbox!.status, "pending");
  });

  it("22. general transport enabled does not dispatch verification rows", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("general-on-verification-off");
    await queueVerificationSend(db, TARGET_USER, email);
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "disabled";
    process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED = "true";
    const fake = new FakeNotificationTransportAdapter("accepted");
    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: new MemoryInboundRawPayloadStore(),
      attachmentStore: new MemoryInboundAttachmentStore(),
      notificationTransport: fake,
    });
    assert.equal(summary.notificationDispatch.selected, 0);
    assert.equal(summary.notificationDispatch.completed, 0);
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    assert.equal(outbox!.status, "pending");
  });

  it("23. general processor skips verification rows after claim", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("query-isolation");
    await queueVerificationSend(db, TARGET_USER, email);
    const trustNow = new Date().toISOString();
    const general = await listDueGeneralNotificationOutboxEvents(db, {
      trustNow,
      limit: 20,
    });
    const verification = await listDueVerificationNotificationOutboxEvents(db, {
      trustNow,
      limit: 20,
    });
    assert.equal(general.length, 0);
    assert.equal(verification.length, 1);
    const claim = await claimNotificationOutboxForProcessing(db, {
      outboxId: verification[0]!.id,
    });
    assert.equal(claim.claimed, true);
    const processed = await processClaimedNotificationOutbox(
      db,
      SYSTEM_MAIL_ACTOR,
      {
        outboxId: verification[0]!.id,
        adapter: new FakeNotificationTransportAdapter("accepted"),
      },
    );
    assert.equal(processed.outcome, "failed_permanent");
  });

  it("24. business outbound transport mode remains disabled", () => {
    assert.equal(resolveMailOutboundTransportMode(process.env), "disabled");
  });

  it("25. verified identity allows enableMailAccess", async () => {
    const email = fixtureEmail("enable-access");
    const capture = createCapturingNotificationVerificationChallengeSink();
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
      { challengeSink: capture.sink },
    );
    const token = capture.latestToken();
    assert.ok(token);
    const [identity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: identity!.id,
      token,
    });
    const enabled = await enableMailAccess(db, permissionActor, TARGET_USER);
    assert.equal(enabled.isEnabled, 1);
  });

  it("26. unverified identity blocks enableMailAccess", async () => {
    const email = fixtureEmail("block-access");
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    await assert.rejects(
      () => enableMailAccess(db, permissionActor, TARGET_USER),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "CONFLICT",
    );
  });

  it("27. enableMailAccess creates no mailbox sender or grants", async () => {
    const email = fixtureEmail("no-auto-provision");
    const capture = createCapturingNotificationVerificationChallengeSink();
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    const adminGrantsBefore = await db
      .select()
      .from(schema.mailAdminGrants)
      .where(eq(schema.mailAdminGrants.userId, TARGET_USER));
    const senderGrantsBefore = await db
      .select()
      .from(schema.mailSenderIdentityGrants)
      .where(eq(schema.mailSenderIdentityGrants.userId, TARGET_USER));
    const mailboxesBefore = await db.select().from(schema.mailMailboxes);

    await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
      { challengeSink: capture.sink },
    );
    const token = capture.latestToken();
    assert.ok(token);
    const [identity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    await verifyNotificationIdentity(db, permissionActor, {
      identityId: identity!.id,
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
});

describe("verification carrier-type isolation (6J.3A gate)", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const previousTestDbBind = process.env.CRM_ALLOW_TEST_DB_BIND;
  const previousVerificationMode =
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR];
  const previousGeneralTransport = process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy({
      configPath: "./wrangler.jsonc",
      persist: { path: ".wrangler/state/v3" },
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
  });

  after(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = previousTestDbBind;
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] =
      previousVerificationMode;
    process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED = previousGeneralTransport;
    dispose?.();
  });

  beforeEach(async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "disabled";
    process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED = "false";
    await cleanupFixtures(db);
  });

  afterEach(async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] =
      previousVerificationMode;
    process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED = previousGeneralTransport;
  });

  it("A. verification row excluded from general due query", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("carrier-a");
    await queueVerificationSend(db, TARGET_USER, email);
    const trustNow = new Date().toISOString();
    const general = await listDueGeneralNotificationOutboxEvents(db, {
      trustNow,
      limit: 20,
    });
    assert.equal(general.length, 0);
  });

  it("B/C. general transport cannot deliver verification carrier rows", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("carrier-bc");
    await queueVerificationSend(db, TARGET_USER, email);
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "disabled";
    process.env.MAIL_NOTIFICATION_TRANSPORT_ENABLED = "true";
    const fake = new FakeNotificationTransportAdapter("accepted");
    const summary = await runMailBackgroundTick(db, {
      rawPayloadStore: new MemoryInboundRawPayloadStore(),
      attachmentStore: new MemoryInboundAttachmentStore(),
      notificationTransport: fake,
    });
    assert.equal(summary.notificationDispatch.completed, 0);
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    assert.equal(outbox!.status, "pending");
  });

  it("D. verification processor rejects general notification rows", async () => {
    const identityId = await createVerifiedIdentity(
      db,
      TARGET_USER,
      fixtureEmail("carrier-d"),
    );
    await enableMailAccessForTest(db, TARGET_USER);
    const { outbox } = await enqueueMailNotificationIntent(db, {
      notificationType: "new_incoming",
      recipientUserId: TARGET_USER,
      notificationIdentityId: identityId,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailMessage,
      sourceEntityId: `${FIXTURE}-message-1`,
      mailboxId: null,
    });
    const claim = await claimNotificationOutboxForProcessing(db, {
      outboxId: outbox.id,
    });
    assert.equal(claim.claimed, true);
    await assert.rejects(
      () =>
        processClaimedVerificationOutboxDelivery(db, SYSTEM_MAIL_ACTOR, {
          outboxId: outbox.id,
          sink: createCapturingNotificationVerificationChallengeSink().sink,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("E. verification rows do not appear in proof notification UI list", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("carrier-e");
    await createPendingNotificationIdentity(db, rootAdminActor, {
      targetUserId: SEED_IDS.admin,
      email,
    });
    await sendNotificationIdentityVerificationChallenge(
      db,
      rootAdminActor,
      SEED_IDS.admin,
    );
    const runs = await listNotificationProofRunsForAdmin(db, rootAdminActor);
    assert.equal(runs.length, 0);
  });

  it("F/G. verification rows bypass verified/access gates intentionally", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("carrier-fg");
    await queueVerificationSend(db, TARGET_USER, email);
    const [identity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    assert.equal(identity!.verificationStatus, "pending");
    const [access] = await db
      .select()
      .from(schema.mailUserAccess)
      .where(eq(schema.mailUserAccess.userId, TARGET_USER));
    assert.equal(access, undefined);
    const capture = createCapturingNotificationVerificationChallengeSink();
    const [outbox] = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    const processed = await dispatchVerificationOutbox(db, outbox!.id, capture.sink);
    assert.equal(processed.outcome, "sent");
  });

  it("H. verification processor requires sourceEntityType discriminator", async () => {
    const email = fixtureEmail("carrier-h");
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    const [identity] = await db
      .select()
      .from(schema.mailNotificationIdentities)
      .where(eq(schema.mailNotificationIdentities.userId, TARGET_USER));
    const { outbox } = await enqueueMailNotificationIntent(db, {
      notificationType: "new_incoming",
      recipientUserId: TARGET_USER,
      notificationIdentityId: identity!.id,
      sourceEntityType: MAIL_NOTIFICATION_SOURCE_ENTITY_TYPES.mailMessage,
      sourceEntityId: `${FIXTURE}-wrong-type`,
      mailboxId: null,
    });
    const claim = await claimNotificationOutboxForProcessing(db, {
      outboxId: outbox.id,
    });
    assert.equal(claim.claimed, true);
    await assert.rejects(
      () =>
        processClaimedVerificationOutboxDelivery(db, SYSTEM_MAIL_ACTOR, {
          outboxId: outbox.id,
          sink: createCapturingNotificationVerificationChallengeSink().sink,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 400,
    );
  });

  it("rate limit counts queue requests without worker double-count", async () => {
    process.env[MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE_VAR] = "production";
    const email = fixtureEmail("rate-limit-async");
    await createPendingNotificationIdentity(db, permissionActor, {
      targetUserId: TARGET_USER,
      email,
    });
    const nowMs = Date.parse("2026-08-26T06:00:00.000Z");
    for (let i = 0; i < 3; i += 1) {
      await sendNotificationIdentityVerificationChallenge(
        db,
        permissionActor,
        TARGET_USER,
        { nowMs: nowMs + i * 1000 },
      );
    }
    await assert.rejects(
      () =>
        sendNotificationIdentityVerificationChallenge(
          db,
          permissionActor,
          TARGET_USER,
          { nowMs: nowMs + 4000 },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 409,
    );

    const capture = createCapturingNotificationVerificationChallengeSink();
    const outboxes = await db
      .select()
      .from(schema.mailNotificationOutbox)
      .where(eq(schema.mailNotificationOutbox.recipientUserId, TARGET_USER));
    for (const outbox of outboxes) {
      await dispatchVerificationOutbox(db, outbox.id, capture.sink);
    }

    await sendNotificationIdentityVerificationChallenge(
      db,
      permissionActor,
      TARGET_USER,
      { nowMs: nowMs + 24 * 60 * 60 * 1000 + 1000 },
    );
  });
});

describe("verification worker config guards", () => {
  it("crm-system wrangler has no EMAIL binding", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    assert.equal(config.includes("send_email"), false);
  });

  it("mail-jobs wrangler has restricted EMAIL binding", () => {
    const config = readFileSync("wrangler.mail-jobs-cron.jsonc", "utf8");
    assert.ok(config.includes("send_email"));
    assert.ok(config.includes("notifications@send.echfronthk.com"));
    assert.ok(config.includes('"MAIL_NOTIFICATION_TRANSPORT_ENABLED": "false"'));
    assert.ok(
      config.includes('"MAIL_NOTIFICATION_VERIFICATION_TRANSPORT_MODE": "disabled"'),
    );
  });
});
