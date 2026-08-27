import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  approveRevision,
  submitRevisionForApproval,
} from "@/lib/mail/outbound-approval-service";
import {
  createOutboundRevisionFromDraft,
} from "@/lib/mail/outbound-revision-service";
import {
  BUSINESS_EMAIL_BINDING_UNAVAILABLE,
} from "@/lib/mail/outbound-business-email-binding";
import {
  processOutboundBackgroundDispatchItem,
} from "@/lib/mail/outbound-background-dispatch-service";
import {
  processOutboundSentMaterializationItem,
} from "@/lib/mail/outbound-sent-materialization-background-service";
import {
  MAIL_OUTBOUND_TRANSPORT_MODE_VAR,
} from "@/lib/mail/outbound-transport-constants";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import {
  addDraftRecipient,
  createDraft,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import {
  initiateStaffApprovedSend,
  sendOperationTestHooks,
} from "@/lib/mail/send-operation-service";
import { materializeAcceptedOutboundSend } from "@/lib/mail/sent-message-materialization-service";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";

const FIXTURE = "mail-phase6n2a";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailActorContext["adminGrants"] = [],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase6n2a-test" },
  };
}

const approvalReviewActor = actor(SEED_IDS.staffB, ["approval_review"]);
const staffActor = actor(SEED_IDS.staffA, []);
const setupAdminActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
  "signature_template",
]);

function fixtureAddress(suffix: string): string {
  return `${FIXTURE}-${suffix}-${crypto.randomUUID().slice(0, 8)}@echfronthk.com`;
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
      set: { isEnabled: 1, updatedAt: now },
    });
}

async function createSendReadyDraft(
  db: TestDb,
  actorCtx: MailActorContext,
  mailboxId: string,
  identityId: string,
): Promise<DraftDetailView> {
  const created = await createDraft(db, actorCtx, {
    senderIdentityId: identityId,
    mailboxId,
    subject: "Send subject",
    bodyText: "Send body",
  });
  assert.ok(created.created);
  return addDraftRecipient(db, actorCtx, {
    draftId: created.item.id,
    expectedAutosaveVersion: created.item.autosaveVersion,
    recipientType: "to",
    address: "client@example.com",
  });
}

async function setupStaffComposeFixture(db: TestDb, suffix: string) {
  const address = fixtureAddress(`staff-${suffix}`);
  const mailbox = await createMailbox(db, setupAdminActor, {
    address,
    mailboxType: "personal",
    ownerUserId: SEED_IDS.staffA,
  });
  const identity = await createSenderIdentity(db, setupAdminActor, {
    address,
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, setupAdminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.staffA,
    canSend: true,
  });
  return { mailbox, identity };
}

async function setupApprovedPendingSend(db: TestDb, suffix: string) {
  const { mailbox, identity } = await setupStaffComposeFixture(db, suffix);
  const draft = await createSendReadyDraft(
    db,
    staffActor,
    mailbox.id,
    identity.id,
  );
  const revision = await createOutboundRevisionFromDraft(db, staffActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
  const approval = await submitRevisionForApproval(db, staffActor, {
    revisionId: revision.id,
  });
  await approveRevision(db, approvalReviewActor, {
    approvalId: approval.id,
    expectedWorkflowVersion: 1,
  });
  const send = await initiateStaffApprovedSend(db, approvalReviewActor, {
    revisionId: revision.id,
    idempotencyKey: `${FIXTURE}-${suffix}-${crypto.randomUUID()}`,
  });
  return { send, revision, identity, mailbox };
}

describe("outbound background dispatch and materialization", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    await enableMailAccess(db, SEED_IDS.admin);
  });

  after(async () => {
    await dispose?.();
  });

  it("disabled transport mode performs zero provider calls", async () => {
    const { send } = await setupApprovedPendingSend(db, "disabled");
    const adapter = new FakeMailTransportAdapter();
    const result = await processOutboundBackgroundDispatchItem(db, {
      env: { [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: "disabled" },
      db,
      resolveAdapter: () => adapter,
    }, send);
    assert.equal(result, "skipped");
    assert.equal(adapter.capture.callCount, 0);
  });

  it("production mode without BUSINESS_EMAIL binding fails closed", async () => {
    const { send } = await setupApprovedPendingSend(db, "no-binding");
    const adapter = new FakeMailTransportAdapter();
    const result = await processOutboundBackgroundDispatchItem(db, {
      env: { [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: "production" },
      db,
      businessEmailBinding: undefined,
      resolveAdapter: () => adapter,
    }, send);
    assert.equal(result, "permanent_failed");
    assert.equal(adapter.capture.callCount, 0);
    const [audit] = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, send.id),
          like(schema.auditLogs.action, "%preflight_blocked%"),
        ),
      )
      .limit(1);
    assert.ok(audit);
    assert.match(JSON.stringify(audit.metadata), new RegExp(BUSINESS_EMAIL_BINDING_UNAVAILABLE));
  });

  it("recovers canonical Sent after acceptance without materialization", async () => {
    assert.ok(sendOperationTestHooks);
    const { send } = await setupApprovedPendingSend(db, "crash-recovery");
    await processOutboundBackgroundDispatchItem(db, {
      env: { [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: "dry_run" },
      db,
    }, send);

    const [acceptedAttempt] = await db
      .select()
      .from(schema.mailTransportAttempts)
      .where(eq(schema.mailTransportAttempts.sendOperationId, send.id));
    assert.equal(acceptedAttempt?.state, "accepted");
    const providerMessageId = acceptedAttempt?.providerMessageId;
    assert.ok(providerMessageId);

    const messagesBefore = await db
      .select()
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.internetMessageId, providerMessageId));
    assert.equal(messagesBefore.length, 0);

    const materialized = await processOutboundSentMaterializationItem(db, send);
    assert.equal(materialized, "completed");

    const messagesAfter = await db
      .select()
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.internetMessageId, providerMessageId));
    assert.equal(messagesAfter.length, 1);

    const again = await processOutboundSentMaterializationItem(db, send);
    assert.equal(again, "completed");
    const messagesFinal = await db
      .select()
      .from(schema.mailMessages)
      .where(eq(schema.mailMessages.internetMessageId, providerMessageId));
    assert.equal(messagesFinal.length, 1);
  });

  it("dry_run transport dispatches one eligible pending operation", async () => {
    const { send } = await setupApprovedPendingSend(db, "dry-run");
    const result = await processOutboundBackgroundDispatchItem(db, {
      env: { [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: "dry_run" },
      db,
    }, send);
    assert.equal(result, "completed");
    const [attempt] = await db
      .select()
      .from(schema.mailTransportAttempts)
      .where(eq(schema.mailTransportAttempts.sendOperationId, send.id));
    assert.equal(attempt?.state, "accepted");
    assert.match(attempt?.providerMessageId ?? "", /^<dry-run-/);
  });

  it("does not materialize Sent without provider_message_id", async () => {
    assert.ok(sendOperationTestHooks);
    const { send } = await setupApprovedPendingSend(db, "missing-provider-id");
    await processOutboundBackgroundDispatchItem(db, {
      env: { [MAIL_OUTBOUND_TRANSPORT_MODE_VAR]: "dry_run" },
      db,
    }, send);

    await db
      .update(schema.mailTransportAttempts)
      .set({ providerMessageId: null })
      .where(eq(schema.mailTransportAttempts.sendOperationId, send.id));

    const result = await processOutboundSentMaterializationItem(db, send);
    assert.equal(result, "skipped");
  });

  it("does not materialize Sent for dispatch_uncertain operations", async () => {
    assert.ok(sendOperationTestHooks);
    const { send } = await setupApprovedPendingSend(db, "dispatch-uncertain");
    const latestSend = await sendOperationTestHooks.findSendById(db, send.id);
    assert.ok(latestSend);
    const claimed = await sendOperationTestHooks.claimDispatchAttempt(
      db,
      approvalReviewActor,
      latestSend,
      new FakeMailTransportAdapter(),
      "dry_run",
    );
    await sendOperationTestHooks.finalizeAttemptAmbiguous(
      db,
      approvalReviewActor,
      await sendOperationTestHooks.findSendById(db, send.id).then((row) => row!),
      claimed.attempt,
      { errorCode: "cloudflare_email_dispatch_uncertain" },
    );
    const result = await processOutboundSentMaterializationItem(db, send);
    assert.equal(result, "skipped");
  });
});
