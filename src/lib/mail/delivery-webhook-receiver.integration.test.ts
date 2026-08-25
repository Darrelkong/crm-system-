import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  addDraftRecipient,
  createDraft,
} from "@/lib/mail/draft-service";
import { receiveDeliveryProviderWebhook } from "@/lib/mail/delivery-webhook-receiver";
import { signDeliveryWebhookRequest } from "@/lib/mail/delivery-webhook-signature";
import { createAdminDirectRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  dispatchSendOperation,
  initiateAdminDirectSend,
} from "@/lib/mail/send-operation-service";
import {
  findSendOperationByProviderMessageId,
  findSendOperationByProviderRequestId,
} from "@/lib/mail/send-operation-provider-lookup";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";

const FIXTURE = "mail-phase2f4b";
const PROVIDER = "fake-local";
const TEST_WEBHOOK_SECRET = "integration-test-delivery-webhook-secret";

function buildSignedWebhookInput(input: {
  payload: Record<string, unknown>;
  receivedAt?: string;
  timestampSeconds?: number;
}) {
  const rawBody = JSON.stringify(input.payload);
  const signed = signDeliveryWebhookRequest({
    secret: TEST_WEBHOOK_SECRET,
    rawBody,
    timestampSeconds: input.timestampSeconds,
  });
  return {
    provider: PROVIDER,
    payload: input.payload,
    rawBody,
    signatureHeader: signed.signatureHeader,
    timestampHeader: signed.timestampHeader,
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    security: { webhookSecret: TEST_WEBHOOK_SECRET },
  };
}

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(userId: string): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants:
      userId === SEED_IDS.admin
        ? ["account_mgmt", "address_assignment", "signature_template"]
        : [],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2f4b-test" },
  };
}

const adminActor = actor(SEED_IDS.admin);

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function fixtureEventId(suffix: string): string {
  return `${FIXTURE}-${suffix}`;
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

async function cleanupFixtures(db: TestDb) {
  const providerEvents = await db
    .select({ id: schema.mailProviderIngestionEvents.id })
    .from(schema.mailProviderIngestionEvents)
    .where(like(schema.mailProviderIngestionEvents.providerEventId, `${FIXTURE}%`));
  const ingestionIds = providerEvents.map((row) => row.id);

  if (ingestionIds.length) {
    await db
      .delete(schema.mailDeliveryIngestionEvents)
      .where(inArray(schema.mailDeliveryIngestionEvents.ingestionEventId, ingestionIds));
    await db
      .delete(schema.mailProviderIngestionEvents)
      .where(inArray(schema.mailProviderIngestionEvents.id, ingestionIds));
  }

  const revisions = await db
    .select({
      id: schema.mailOutboundRevisions.id,
      sourceDraftId: schema.mailOutboundRevisions.sourceDraftId,
    })
    .from(schema.mailOutboundRevisions)
    .where(like(schema.mailOutboundRevisions.subject, "Delivery webhook%"));
  const revisionIds = revisions.map((row) => row.id);
  const draftIds = [
    ...new Set(
      revisions
        .map((row) => row.sourceDraftId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (revisionIds.length) {
    const sends = await db
      .select({ id: schema.mailSendOperations.id })
      .from(schema.mailSendOperations)
      .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds));
    const sendIds = sends.map((row) => row.id);

    if (sendIds.length) {
      await db
        .delete(schema.mailDeliveryEvents)
        .where(inArray(schema.mailDeliveryEvents.sendOperationId, sendIds));
      await db
        .delete(schema.mailTransportAttempts)
        .where(inArray(schema.mailTransportAttempts.sendOperationId, sendIds));
      await db
        .delete(schema.mailSendOperations)
        .where(inArray(schema.mailSendOperations.id, sendIds));
    }

    await db
      .delete(schema.mailOutboundRevisionRecipients)
      .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
    await db
      .delete(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
  }

  if (draftIds.length) {
    await db
      .delete(schema.mailDraftRecipients)
      .where(inArray(schema.mailDraftRecipients.draftId, draftIds));
    await db
      .delete(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.id, draftIds));
  }

  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);
  if (mailboxIds.length) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
  const identityIds = identities.map((row) => row.id);
  if (identityIds.length) {
    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }
}

async function setupAcceptedSend(db: TestDb) {
  const address = fixtureAddress("mailbox");
  const mailbox = await createMailbox(db, adminActor, {
    address,
    mailboxType: "personal",
  });
  const identity = await createSenderIdentity(db, adminActor, {
    address: fixtureAddress("sender"),
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, adminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.admin,
    canSend: true,
  });
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: `${FIXTURE}-admin-member`,
    mailboxId: mailbox.id,
    userId: SEED_IDS.admin,
    canRead: 1,
    canReply: 1,
    canSend: 1,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });

  const created = await createDraft(db, adminActor, {
    senderIdentityId: identity.id,
    mailboxId: mailbox.id,
    subject: "Delivery webhook test",
    bodyText: "Body",
  });
  assert.ok(created.created);
  const draft = await addDraftRecipient(db, adminActor, {
    draftId: created.item.id,
    expectedAutosaveVersion: created.item.autosaveVersion,
    recipientType: "to",
    address: "webhook-client@example.com",
  });
  const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });

  const providerMessageId = fixtureEventId("msg-webhook");
  const providerRequestId = fixtureEventId("req-webhook");
  const initiated = await initiateAdminDirectSend(db, adminActor, {
    revisionId: revision.id,
    idempotencyKey: `${FIXTURE}-send`,
  });
  const transport = new FakeMailTransportAdapter().setBehavior({
    outcome: "accepted",
    providerRequestId,
    providerMessageId,
  });
  await dispatchSendOperation(db, adminActor, {
    sendOperationId: initiated.id,
    expectedOrchestrationVersion: initiated.orchestrationVersion,
    adapter: transport,
  });

  return { sendOperationId: initiated.id, providerMessageId, providerRequestId };
}

describe("delivery webhook receiver integration", () => {
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
    await enableMailAccess(db, SEED_IDS.admin);
    await cleanupFixtures(db);
  });

  after(async () => {
    try {
      await cleanupFixtures(db);
    } finally {
      dispose?.();
    }
  });

  it("maps provider ids back to mail_send_operations", async () => {
    await cleanupFixtures(db);
    const { sendOperationId, providerMessageId, providerRequestId } =
      await setupAcceptedSend(db);

    const byMessage = await findSendOperationByProviderMessageId(db, {
      provider: PROVIDER,
      providerMessageId,
    });
    assert.ok(byMessage);
    assert.equal(byMessage.sendOperationId, sendOperationId);

    const byRequest = await findSendOperationByProviderRequestId(db, {
      provider: PROVIDER,
      providerRequestId,
    });
    assert.ok(byRequest);
    assert.equal(byRequest.sendOperationId, sendOperationId);
  });

  it("replays identical webhook payloads idempotently", async () => {
    await cleanupFixtures(db);
    const { providerMessageId } = await setupAcceptedSend(db);
    const providerEventId = fixtureEventId(`evt-webhook-${crypto.randomUUID()}`);
    const payload = {
      eventId: providerEventId,
      eventType: "delivered",
      messageId: providerMessageId,
      recipient: "webhook-client@example.com",
    };
    const webhookInput = buildSignedWebhookInput({ payload });

    const first = await receiveDeliveryProviderWebhook(db, null, webhookInput);
    const replay = await receiveDeliveryProviderWebhook(db, null, webhookInput);

    assert.equal(first.staged.durablyStaged, true);
    assert.equal(first.staged.idempotentReplay, false);
    assert.equal(replay.staged.idempotentReplay, true);
    assert.equal(replay.staged.ingestionEventId, first.staged.ingestionEventId);
    assert.ok(first.providerLookup);
    assert.equal(
      first.providerLookup?.sendOperationId,
      replay.providerLookup?.sendOperationId,
    );
  });
});
