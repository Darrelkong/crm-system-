import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  addDraftRecipient,
  createDraft,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { claimProviderIngestionForProcessing } from "@/lib/mail/provider-ingestion-claim";
import {
  attemptInvalidDeliveryMaterializationBatch,
  deliveryEventMaterializationTestHooks,
  materializeDeliveryIngestionEvent,
} from "@/lib/mail/delivery-event-materialization-service";
import { stageDeliveryProviderEvent } from "@/lib/mail/delivery-provider-staging-service";
import { MailServiceError } from "@/lib/mail/errors";
import { createAdminDirectRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  dispatchSendOperation,
  initiateAdminDirectSend,
  retrySendOperation,
} from "@/lib/mail/send-operation-service";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";

const FIXTURE = "mail-phase2c11";
const PROVIDER = "fake-local";

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
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c11-test" },
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
    const materializations = await db
      .select({
        deliveryEventId: schema.mailDeliveryEventMaterializations.deliveryEventId,
      })
      .from(schema.mailDeliveryEventMaterializations)
      .where(
        inArray(schema.mailDeliveryEventMaterializations.ingestionEventId, ingestionIds),
      );
    const deliveryEventIds = materializations.map((row) => row.deliveryEventId);

    await db
      .delete(schema.mailDeliveryEventMaterializations)
      .where(
        inArray(schema.mailDeliveryEventMaterializations.ingestionEventId, ingestionIds),
      );
    if (deliveryEventIds.length) {
      await db
        .delete(schema.mailDeliveryEvents)
        .where(inArray(schema.mailDeliveryEvents.id, deliveryEventIds));
    }
    await db
      .delete(schema.mailDeliveryIngestionEvents)
      .where(
        inArray(schema.mailDeliveryIngestionEvents.ingestionEventId, ingestionIds),
      );
    await db
      .delete(schema.mailProviderIngestionEvents)
      .where(inArray(schema.mailProviderIngestionEvents.id, ingestionIds));
  }

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
  const identityIds = identities.map((row) => row.id);

  const drafts =
    identityIds.length > 0
      ? await db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.senderIdentityId, identityIds))
      : [];
  const draftIds = drafts.map((row) => row.id);

  const revisions = identityIds.length
    ? await db
        .select({
          id: schema.mailOutboundRevisions.id,
          signatureSnapshotId: schema.mailOutboundRevisions.signatureSnapshotId,
        })
        .from(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.senderIdentityId, identityIds))
    : [];
  const revisionIds = revisions.map((row) => row.id);

  const sendOps = revisionIds.length
    ? await db
        .select({ id: schema.mailSendOperations.id })
        .from(schema.mailSendOperations)
        .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds))
    : [];
  const sendIds = sendOps.map((row) => row.id);

  if (sendIds.length) {
    const deliveryEvents = await db
      .select({ id: schema.mailDeliveryEvents.id })
      .from(schema.mailDeliveryEvents)
      .where(inArray(schema.mailDeliveryEvents.sendOperationId, sendIds));
    const deliveryEventIds = deliveryEvents.map((row) => row.id);
    if (deliveryEventIds.length) {
      await db
        .delete(schema.mailDeliveryEventMaterializations)
        .where(
          inArray(
            schema.mailDeliveryEventMaterializations.deliveryEventId,
            deliveryEventIds,
          ),
        );
      await db
        .delete(schema.mailDeliveryEvents)
        .where(inArray(schema.mailDeliveryEvents.id, deliveryEventIds));
    }

    await db
      .delete(schema.mailTransportAttempts)
      .where(inArray(schema.mailTransportAttempts.sendOperationId, sendIds));
    await db
      .delete(schema.mailOutboundRfcIdentities)
      .where(inArray(schema.mailOutboundRfcIdentities.sendOperationId, sendIds));
    await db
      .delete(schema.mailSendOperations)
      .where(inArray(schema.mailSendOperations.id, sendIds));
  }

  const snapshotIds = [
    ...new Set([
      ...revisions.map((row) => row.signatureSnapshotId),
      ...(identityIds.length
        ? (
            await db
              .select({ id: schema.mailSignatureSnapshots.id })
              .from(schema.mailSignatureSnapshots)
              .where(
                inArray(schema.mailSignatureSnapshots.senderIdentityId, identityIds),
              )
          ).map((row) => row.id)
        : []),
    ]),
  ];

  if (revisionIds.length) {
    await db
      .delete(schema.mailOutboundRevisionAttachments)
      .where(inArray(schema.mailOutboundRevisionAttachments.revisionId, revisionIds));
    await db
      .delete(schema.mailOutboundRevisionRecipients)
      .where(inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds));
    await db
      .delete(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
  }

  if (snapshotIds.length) {
    await db
      .delete(schema.mailSignatureSnapshotAssets)
      .where(inArray(schema.mailSignatureSnapshotAssets.signatureSnapshotId, snapshotIds));
    await db
      .delete(schema.mailSignatureSnapshots)
      .where(inArray(schema.mailSignatureSnapshots.id, snapshotIds));
  }

  if (draftIds.length) {
    await db
      .delete(schema.mailDraftRecipients)
      .where(inArray(schema.mailDraftRecipients.draftId, draftIds));
    await db
      .delete(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.id, draftIds));
  }

  if (identityIds.length) {
    const signatureVersions = await db
      .select({ id: schema.mailSignatureVersions.id })
      .from(schema.mailSignatureVersions)
      .where(inArray(schema.mailSignatureVersions.senderIdentityId, identityIds));
    const signatureVersionIds = signatureVersions.map((row) => row.id);
    if (signatureVersionIds.length) {
      await db
        .delete(schema.mailSignatureVersionAssets)
        .where(
          inArray(schema.mailSignatureVersionAssets.signatureVersionId, signatureVersionIds),
        );
      await db
        .delete(schema.mailSignatureVersions)
        .where(inArray(schema.mailSignatureVersions.id, signatureVersionIds));
    }

    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);
  if (mailboxIds.length) {
    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }
}

async function setupAdminComposeFixture(db: TestDb, fixtureSuffix = "") {
  const address = fixtureAddress(`compose-mailbox${fixtureSuffix}`);
  const mailbox = await createMailbox(db, adminActor, {
    address,
    mailboxType: "personal",
  });
  const identity = await createSenderIdentity(db, adminActor, {
    address: fixtureAddress(`sender${fixtureSuffix}`),
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, adminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.admin,
    canSend: true,
  });
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: `${FIXTURE}-admin-member${fixtureSuffix}`,
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
  return { mailbox, identity };
}

async function createDraftWithRecipients(
  db: TestDb,
  recipients: Array<{
    recipientType: "to" | "cc" | "bcc";
    address: string;
  }>,
  fixtureSuffix = "",
): Promise<{
  mailbox: Awaited<ReturnType<typeof setupAdminComposeFixture>>["mailbox"];
  identity: Awaited<ReturnType<typeof setupAdminComposeFixture>>["identity"];
  draft: DraftDetailView;
  revision: Awaited<ReturnType<typeof createAdminDirectRevisionFromDraft>>;
}> {
  const { mailbox, identity } = await setupAdminComposeFixture(db, fixtureSuffix);
  const created = await createDraft(db, adminActor, {
    senderIdentityId: identity.id,
    mailboxId: mailbox.id,
    subject: "Delivery test",
    bodyText: "Body",
  });
  assert.ok(created.created);
  let draft = created.item;
  for (const recipient of recipients) {
    draft = await addDraftRecipient(db, adminActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      recipientType: recipient.recipientType,
      address: recipient.address,
    });
  }
  const revision = await createAdminDirectRevisionFromDraft(db, adminActor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
  return { mailbox, identity, draft, revision };
}

async function acceptSend(
  db: TestDb,
  revisionId: string,
  providerMessageId: string,
  adapter?: FakeMailTransportAdapter,
) {
  const initiated = await initiateAdminDirectSend(db, adminActor, {
    revisionId,
    idempotencyKey: `${FIXTURE}-send-${revisionId}-${providerMessageId}`,
  });
  const transport =
    adapter ??
    new FakeMailTransportAdapter().setBehavior({
      outcome: "accepted",
      providerRequestId: `${FIXTURE}-req`,
      providerMessageId,
    });
  const dispatched = await dispatchSendOperation(db, adminActor, {
    sendOperationId: initiated.id,
    expectedOrchestrationVersion: initiated.orchestrationVersion,
    adapter: transport,
  });
  return { initiated, dispatched };
}

async function stageDelivery(
  db: TestDb,
  input: {
    providerEventId: string;
    providerMessageId: string;
    recipientAddress: string;
    deliveryEventType: "deferred" | "delivered" | "bounced";
    providerOccurredAt?: string;
    smtpStatusCode?: string;
    diagnosticMessage?: string;
  },
) {
  return stageDeliveryProviderEvent(db, null, {
    provider: PROVIDER,
    providerEventId: input.providerEventId,
    providerMessageId: input.providerMessageId,
    recipientAddress: input.recipientAddress,
    deliveryEventType: input.deliveryEventType,
    providerOccurredAt: input.providerOccurredAt,
    smtpStatusCode: input.smtpStatusCode,
    diagnosticMessage: input.diagnosticMessage,
    receivedAt: new Date().toISOString(),
  });
}

async function stageAndMaterialize(
  db: TestDb,
  input: Parameters<typeof stageDelivery>[1],
) {
  const staged = await stageDelivery(db, input);
  assert.equal(staged.durablyStaged, true);
  if (staged.providerStatus === "quarantined") {
    return { staged, materialized: null };
  }
  const materialized = await materializeDeliveryIngestionEvent(db, {
    ingestionEventId: staged.ingestionEventId,
  });
  return { staged, materialized };
}

async function loadRevisionRecipients(db: TestDb, revisionId: string) {
  return db
    .select()
    .from(schema.mailOutboundRevisionRecipients)
    .where(eq(schema.mailOutboundRevisionRecipients.revisionId, revisionId))
    .orderBy(asc(schema.mailOutboundRevisionRecipients.sortOrder));
}

describe("delivery event materialization integration", () => {
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
    assert.ok(deliveryEventMaterializationTestHooks);
  });

  after(async () => {
    try {
      await cleanupFixtures(db);
    } finally {
      dispose?.();
    }
  });

  it("delivered event materializes for exact recipient only", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "alice@example.com" },
      { recipientType: "to", address: "bob@example.com" },
    ]);
    const { initiated, dispatched } = await acceptSend(
      db,
      revision.id,
      fixtureEventId("msg-delivered-basic"),
    );

    const recipients = await loadRevisionRecipients(db, revision.id);
    const alice = recipients.find((row) => row.address === "alice@example.com");
    assert.ok(alice);

    const { materialized } = await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-delivered-alice"),
      providerMessageId: fixtureEventId("msg-delivered-basic"),
      recipientAddress: "alice@example.com",
      deliveryEventType: "delivered",
    });
    assert.ok(materialized);

    const events = await db
      .select()
      .from(schema.mailDeliveryEvents)
      .where(eq(schema.mailDeliveryEvents.sendOperationId, initiated.id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "delivered");
    assert.equal(events[0]!.outboundRevisionRecipientId, alice.id);
    assert.equal(events[0]!.transportAttemptId, dispatched.transportAttempts?.[0]?.id);

    const [send] = await db
      .select()
      .from(schema.mailSendOperations)
      .where(eq(schema.mailSendOperations.id, initiated.id))
      .limit(1);
    assert.equal(send?.status, "accepted");

    const attempts = await db
      .select()
      .from(schema.mailTransportAttempts)
      .where(eq(schema.mailTransportAttempts.sendOperationId, initiated.id));
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.state, "accepted");
  });

  it("deferred event does not create resend or mutate send", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "alice@example.com" },
    ]);
    const { initiated } = await acceptSend(
      db,
      revision.id,
      fixtureEventId("msg-deferred"),
    );

    await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-deferred"),
      providerMessageId: fixtureEventId("msg-deferred"),
      recipientAddress: "alice@example.com",
      deliveryEventType: "deferred",
      smtpStatusCode: "451",
      diagnosticMessage: "try again later",
    });

    const events = await db
      .select()
      .from(schema.mailDeliveryEvents)
      .where(eq(schema.mailDeliveryEvents.sendOperationId, initiated.id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "deferred");

    const attempts = await db
      .select()
      .from(schema.mailTransportAttempts)
      .where(eq(schema.mailTransportAttempts.sendOperationId, initiated.id));
    assert.equal(attempts.length, 1);
  });

  it("bounced event does not mutate send or create suppression", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "bob@example.com" },
    ]);
    const { initiated } = await acceptSend(
      db,
      revision.id,
      fixtureEventId("msg-bounced"),
    );

    await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-bounced"),
      providerMessageId: fixtureEventId("msg-bounced"),
      recipientAddress: "bob@example.com",
      deliveryEventType: "bounced",
      smtpStatusCode: "550",
      diagnosticMessage: "user unknown",
    });

    const [send] = await db
      .select()
      .from(schema.mailSendOperations)
      .where(eq(schema.mailSendOperations.id, initiated.id))
      .limit(1);
    assert.equal(send?.status, "accepted");

    const events = await db
      .select()
      .from(schema.mailDeliveryEvents)
      .where(eq(schema.mailDeliveryEvents.sendOperationId, initiated.id));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "bounced");
  });

  it("materializes independent per-recipient mixed outcomes", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "a-mixed@example.com" },
      { recipientType: "cc", address: "b-mixed@example.com" },
      { recipientType: "bcc", address: "c-mixed@example.com" },
    ]);
    const { initiated } = await acceptSend(
      db,
      revision.id,
      fixtureEventId("msg-mixed"),
    );
    const recipients = await loadRevisionRecipients(db, revision.id);

    await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-mixed-a"),
      providerMessageId: fixtureEventId("msg-mixed"),
      recipientAddress: "a-mixed@example.com",
      deliveryEventType: "delivered",
    });
    await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-mixed-b"),
      providerMessageId: fixtureEventId("msg-mixed"),
      recipientAddress: "b-mixed@example.com",
      deliveryEventType: "bounced",
    });
    await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-mixed-c"),
      providerMessageId: fixtureEventId("msg-mixed"),
      recipientAddress: "c-mixed@example.com",
      deliveryEventType: "deferred",
    });

    const events = await db
      .select()
      .from(schema.mailDeliveryEvents)
      .where(eq(schema.mailDeliveryEvents.sendOperationId, initiated.id));
    assert.equal(events.length, 3);
    const byRecipient = new Map(
      events.map((event) => [event.outboundRevisionRecipientId, event.eventType]),
    );
    const a = recipients.find((row) => row.address === "a-mixed@example.com");
    const b = recipients.find((row) => row.address === "b-mixed@example.com");
    const c = recipients.find((row) => row.address === "c-mixed@example.com");
    assert.equal(byRecipient.get(a!.id), "delivered");
    assert.equal(byRecipient.get(b!.id), "bounced");
    assert.equal(byRecipient.get(c!.id), "deferred");
  });

  it("correlates delivery to accepted retry attempt not temporary failure", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "retry@example.com" },
    ]);
    const initiated = await initiateAdminDirectSend(db, adminActor, {
      revisionId: revision.id,
      idempotencyKey: `${FIXTURE}-retry-send`,
    });
    const adapter = new FakeMailTransportAdapter()
      .queueBehavior({ outcome: "temporary_failure", errorCode: "TEMP" })
      .queueBehavior({
        outcome: "accepted",
        providerRequestId: `${FIXTURE}-retry-req`,
        providerMessageId: fixtureEventId("msg-retry-accepted"),
      });
    const afterTemp = await dispatchSendOperation(db, adminActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: initiated.orchestrationVersion,
      adapter,
    });
    assert.equal(afterTemp.transportAttempts?.[0]?.state, "temporary_failure");

    const afterRetry = await retrySendOperation(db, adminActor, {
      sendOperationId: initiated.id,
      expectedOrchestrationVersion: afterTemp.orchestrationVersion,
      adapter,
    });
    assert.equal(afterRetry.status, "accepted");
    assert.equal(afterRetry.transportAttempts?.length, 2);

    const acceptedAttempt = afterRetry.transportAttempts?.[1];
    assert.equal(acceptedAttempt?.state, "accepted");

    const { materialized } = await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-retry"),
      providerMessageId: fixtureEventId("msg-retry-accepted"),
      recipientAddress: "retry@example.com",
      deliveryEventType: "delivered",
    });
    assert.ok(materialized);
    assert.equal(
      materialized.deliveryEvent.transportAttemptId,
      acceptedAttempt?.id,
    );
    assert.notEqual(
      materialized.deliveryEvent.transportAttemptId,
      afterRetry.transportAttempts?.[0]?.id,
    );
  });

  it("preserves bcc revision recipient provenance", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "visible@example.com" },
      { recipientType: "bcc", address: "hidden@example.com" },
    ]);
    await acceptSend(db, revision.id, fixtureEventId("msg-bcc"));
    const recipients = await loadRevisionRecipients(db, revision.id);
    const bcc = recipients.find((row) => row.recipientType === "bcc");
    assert.ok(bcc);

    const { materialized } = await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-bcc"),
      providerMessageId: fixtureEventId("msg-bcc"),
      recipientAddress: "hidden@example.com",
      deliveryEventType: "delivered",
    });
    assert.ok(materialized);
    assert.equal(
      materialized.deliveryEvent.outboundRevisionRecipientId,
      bcc.id,
    );
  });

  it("replays identical provider delivery event idempotently", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "replay@example.com" },
    ]);
    await acceptSend(db, revision.id, fixtureEventId("msg-replay"));

    const first = await stageDelivery(db, {
      providerEventId: fixtureEventId("evt-replay"),
      providerMessageId: fixtureEventId("msg-replay"),
      recipientAddress: "replay@example.com",
      deliveryEventType: "delivered",
    });
    const replay = await stageDelivery(db, {
      providerEventId: fixtureEventId("evt-replay"),
      providerMessageId: fixtureEventId("msg-replay"),
      recipientAddress: "replay@example.com",
      deliveryEventType: "delivered",
    });
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.ingestionEventId, first.ingestionEventId);

    const mat1 = await materializeDeliveryIngestionEvent(db, {
      ingestionEventId: first.ingestionEventId,
    });
    const mat2 = await materializeDeliveryIngestionEvent(db, {
      ingestionEventId: first.ingestionEventId,
    });
    assert.equal(mat1.deliveryEvent.id, mat2.deliveryEvent.id);
    assert.equal(mat1.materialization.id, mat2.materialization.id);

    const events = await db.select().from(schema.mailDeliveryEvents);
    assert.equal(events.filter((row) => row.eventDedupeKey === first.eventDedupeKey).length, 1);
  });

  it("rejects dedupe collision with different delivery semantics", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "conflict@example.com" },
    ]);
    await acceptSend(db, revision.id, fixtureEventId("msg-conflict-a"));

    await stageDelivery(db, {
      providerEventId: fixtureEventId("evt-conflict"),
      providerMessageId: fixtureEventId("msg-conflict-a"),
      recipientAddress: "conflict@example.com",
      deliveryEventType: "delivered",
    });

    await assert.rejects(
      () =>
        stageDelivery(db, {
          providerEventId: fixtureEventId("evt-conflict"),
          providerMessageId: fixtureEventId("msg-conflict-b"),
          recipientAddress: "conflict@example.com",
          deliveryEventType: "delivered",
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.errorCode === "INTEGRITY_CONFLICT",
    );
  });

  it("preserves out-of-order delivery history without overwriting", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "ooo@example.com" },
    ]);
    const { initiated } = await acceptSend(db, revision.id, fixtureEventId("msg-ooo"));

    await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-ooo-delivered"),
      providerMessageId: fixtureEventId("msg-ooo"),
      recipientAddress: "ooo@example.com",
      deliveryEventType: "delivered",
      providerOccurredAt: "2026-08-21T12:00:00.000Z",
    });
    await stageAndMaterialize(db, {
      providerEventId: fixtureEventId("evt-ooo-deferred"),
      providerMessageId: fixtureEventId("msg-ooo"),
      recipientAddress: "ooo@example.com",
      deliveryEventType: "deferred",
      providerOccurredAt: "2026-08-21T11:00:00.000Z",
    });

    const events = await db
      .select()
      .from(schema.mailDeliveryEvents)
      .where(eq(schema.mailDeliveryEvents.sendOperationId, initiated.id))
      .orderBy(asc(schema.mailDeliveryEvents.receivedAt));
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((event) => event.eventType).sort(),
      ["deferred", "delivered"],
    );
  });

  it("quarantines when provider message identity is missing for correlation", async () => {
    await cleanupFixtures(db);
    const { revision: revision1 } = await createDraftWithRecipients(
      db,
      [{ recipientType: "to", address: "noguess@example.com" }],
      "-a",
    );
    await acceptSend(db, revision1.id, fixtureEventId("msg-noguess-1"));
    const { revision: revision2 } = await createDraftWithRecipients(
      db,
      [{ recipientType: "to", address: "noguess@example.com" }],
      "-b",
    );
    await acceptSend(db, revision2.id, fixtureEventId("msg-noguess-2"));

    const staged = await stageDelivery(db, {
      providerEventId: fixtureEventId("evt-noguess"),
      providerMessageId: "",
      recipientAddress: "noguess@example.com",
      deliveryEventType: "delivered",
    });
    assert.equal(staged.providerStatus, "quarantined");
    assert.equal(staged.quarantineReason, "missing_provider_message_id");

    const events = await db.select().from(schema.mailDeliveryEvents);
    assert.equal(events.length, 0);
  });

  it("rolls back partial delivery state when guarded materialization fails", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "rollback@example.com" },
    ]);
    await acceptSend(db, revision.id, fixtureEventId("msg-rollback"));

    const staged = await stageDelivery(db, {
      providerEventId: fixtureEventId("evt-rollback"),
      providerMessageId: fixtureEventId("msg-rollback"),
      recipientAddress: "rollback@example.com",
      deliveryEventType: "delivered",
    });

    await claimProviderIngestionForProcessing(db, {
      ingestionEventId: staged.ingestionEventId,
      expectedProcessingVersion: 1,
    });

    const eventsBefore = await db.select().from(schema.mailDeliveryEvents);
    assert.equal(eventsBefore.length, 0);

    await assert.rejects(() =>
      attemptInvalidDeliveryMaterializationBatch(db, staged.ingestionEventId),
    );

    const eventsAfter = await db.select().from(schema.mailDeliveryEvents);
    assert.equal(eventsAfter.length, 0);

    const materializations = await db
      .select()
      .from(schema.mailDeliveryEventMaterializations)
      .where(
        eq(
          schema.mailDeliveryEventMaterializations.ingestionEventId,
          staged.ingestionEventId,
        ),
      );
    assert.equal(materializations.length, 0);

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, staged.ingestionEventId))
      .limit(1);
    assert.equal(provider?.status, "processing");
  });

  it("writes delivery materialized audit without sensitive payload fields", async () => {
    await cleanupFixtures(db);
    const { revision } = await createDraftWithRecipients(db, [
      { recipientType: "to", address: "audit@example.com" },
    ]);
    const { initiated } = await acceptSend(db, revision.id, fixtureEventId("msg-audit"));

    const staged = await stageDelivery(db, {
      providerEventId: fixtureEventId("evt-audit"),
      providerMessageId: fixtureEventId("msg-audit"),
      recipientAddress: "audit@example.com",
      deliveryEventType: "delivered",
    });
    await materializeDeliveryIngestionEvent(db, {
      ingestionEventId: staged.ingestionEventId,
    });

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, staged.ingestionEventId),
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.deliveryMaterialized),
        ),
      );
    assert.equal(audits.length, 1);
    const metadata = JSON.parse(audits[0]!.metadata ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(metadata.sendOperationId, initiated.id);
    assert.equal(metadata.eventType, "delivered");
    assert.equal(metadata.rawPayload, undefined);
    assert.equal(metadata.storageKey, undefined);
  });
});
