import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import { DELIVERY_QUARANTINE_REASONS } from "@/lib/mail/delivery-quarantine-reasons";
import {
  addDraftRecipient,
  createDraft,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { stageDeliveryProviderEvent } from "@/lib/mail/delivery-provider-staging-service";
import { MailServiceError } from "@/lib/mail/errors";
import {
  buildInboundProviderQuarantineUpdate,
  runGuardedUpdate,
} from "@/lib/mail/guarded-batch";
import { claimProviderIngestionForProcessing } from "@/lib/mail/provider-ingestion-claim";
import { setInboundFallbackMailbox } from "@/lib/mail/inbound-fallback-config-service";
import { INBOUND_QUARANTINE_REASONS } from "@/lib/mail/inbound-quarantine-reasons";
import {
  MemoryInboundRawPayloadStore,
} from "@/lib/mail/inbound-raw-payload-store";
import {
  materializeInboundIngestionEvent,
} from "@/lib/mail/inbound-message-materialization-service";
import { stageInboundProviderEvent } from "@/lib/mail/inbound-provider-staging-service";
import {
  listQuarantinedIngestionEvents,
  replayQuarantinedIngestionEvent,
  STUCK_PROCESSING_RECOVERY_SCHEMA_GAP,
} from "@/lib/mail/ingestion-quarantine-replay-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createAdminDirectRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  dispatchSendOperation,
  initiateAdminDirectSend,
} from "@/lib/mail/send-operation-service";
import { MemoryInboundAttachmentStore } from "@/lib/mail/inbound-attachment-store";
import { FakeMailTransportAdapter } from "@/lib/mail/transport/fake-mail-transport-adapter";
import { assertMailDeliveryHealth } from "@/lib/permissions/mail";

const FIXTURE = "mail-phase2c12a";
const PROVIDER = "fake-local";
const RECEIVED_AT = "2026-08-21T10:00:00.000Z";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailActorContext["adminGrants"] = [],
  crmRole: MailActorContext["crmRole"] = userId === SEED_IDS.admin ? "admin" : "staff",
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole,
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c12a-test" },
  };
}

const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);
const deliveryHealthActor = actor(SEED_IDS.staffA, ["delivery_health"]);
const accountMgmtActor = actor(SEED_IDS.staffA, ["account_mgmt"]);
const approvalReviewActor = actor(SEED_IDS.staffA, ["approval_review"]);
const globalMailReadActor = actor(SEED_IDS.staffA, ["global_mail_read"]);
const ordinaryStaffActor = actor(SEED_IDS.staffA, []);
const adminActor = actor(SEED_IDS.admin, [
  "account_mgmt",
  "address_assignment",
  "signature_template",
]);

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

function sampleMime(): Uint8Array {
  return new TextEncoder().encode(
    "From: sender@external.test\r\nTo: ignored@example.com\r\nSubject: replay\r\nMessage-ID: <replay@external.test>\r\n\r\nbody",
  );
}

function buildMime(input: { messageId: string; subject?: string }): Uint8Array {
  return new TextEncoder().encode(
    `From: sender@external.test\r\nTo: ignored@example.com\r\nSubject: ${input.subject ?? "replay"}\r\nMessage-ID: ${input.messageId}\r\n\r\nbody`,
  );
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

async function insertReceivingAddress(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    address: string;
    status: "active" | "suspended" | "retired";
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailReceivingAddresses).values({
    id: input.id,
    mailboxId: input.mailboxId,
    address: input.address,
    addressType: "primary",
    status: input.status,
    createdAt: now,
    updatedAt: now,
    retiredAt: input.status === "retired" ? now : null,
  });
}

async function insertFixtureMailbox(
  db: TestDb,
  input: {
    id: string;
    address: string;
    status: "active" | "suspended" | "archived" | "deleted";
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxes).values({
    id: input.id,
    address: input.address,
    displayName: input.id,
    mailboxType: "shared",
    status: input.status,
    deletedAt: input.status === "deleted" ? now : null,
    createdBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

async function deleteMessagesByIds(db: TestDb, messageIds: string[]) {
  if (!messageIds.length) {
    return;
  }
  await db
    .delete(schema.mailInboundMessageMaterializations)
    .where(inArray(schema.mailInboundMessageMaterializations.mailMessageId, messageIds));
  await db
    .delete(schema.mailMessageReadStates)
    .where(inArray(schema.mailMessageReadStates.messageId, messageIds));
  await db
    .delete(schema.mailMessageRecipients)
    .where(inArray(schema.mailMessageRecipients.messageId, messageIds));
  await db
    .delete(schema.mailMessageAttachments)
    .where(inArray(schema.mailMessageAttachments.messageId, messageIds));
  await db
    .delete(schema.mailMessageBodies)
    .where(inArray(schema.mailMessageBodies.messageId, messageIds));
  await db
    .delete(schema.mailMessages)
    .where(inArray(schema.mailMessages.id, messageIds));
}

async function cleanupFixtures(db: TestDb) {
  await db
    .delete(schema.auditLogs)
    .where(
      like(
        schema.auditLogs.action,
        `${MAIL_AUDIT_ACTIONS.ingestionQuarantineReplayed}%`,
      ),
    );

  const providerEvents = await db
    .select({ id: schema.mailProviderIngestionEvents.id })
    .from(schema.mailProviderIngestionEvents)
    .where(like(schema.mailProviderIngestionEvents.providerEventId, `${FIXTURE}%`));
  const ingestionIds = providerEvents.map((row) => row.id);

  if (ingestionIds.length) {
    const inboundMaterializations = await db
      .select({ messageId: schema.mailInboundMessageMaterializations.mailMessageId })
      .from(schema.mailInboundMessageMaterializations)
      .where(
        inArray(
          schema.mailInboundMessageMaterializations.ingestionEventId,
          ingestionIds,
        ),
      );
    const inboundMessageIds = [
      ...new Set(inboundMaterializations.map((row) => row.messageId)),
    ];

    const deliveryMaterializations = await db
      .select({ deliveryEventId: schema.mailDeliveryEventMaterializations.deliveryEventId })
      .from(schema.mailDeliveryEventMaterializations)
      .where(
        inArray(
          schema.mailDeliveryEventMaterializations.ingestionEventId,
          ingestionIds,
        ),
      );
    const deliveryEventIds = deliveryMaterializations.map(
      (row) => row.deliveryEventId,
    );

    await db
      .delete(schema.mailInboundMessageMaterializations)
      .where(
        inArray(
          schema.mailInboundMessageMaterializations.ingestionEventId,
          ingestionIds,
        ),
      );
    await db
      .delete(schema.mailDeliveryEventMaterializations)
      .where(
        inArray(
          schema.mailDeliveryEventMaterializations.ingestionEventId,
          ingestionIds,
        ),
      );
    if (deliveryEventIds.length) {
      await db
        .delete(schema.mailDeliveryEvents)
        .where(inArray(schema.mailDeliveryEvents.id, deliveryEventIds));
    }
    if (inboundMessageIds.length) {
      await deleteMessagesByIds(db, inboundMessageIds);
    }

    await db
      .delete(schema.mailInboundIngestionEvents)
      .where(
        inArray(schema.mailInboundIngestionEvents.ingestionEventId, ingestionIds),
      );
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
    const sendDeliveryEventIds = deliveryEvents.map((row) => row.id);
    if (sendDeliveryEventIds.length) {
      await db
        .delete(schema.mailDeliveryEventMaterializations)
        .where(
          inArray(
            schema.mailDeliveryEventMaterializations.deliveryEventId,
            sendDeliveryEventIds,
          ),
        );
      await db
        .delete(schema.mailDeliveryEvents)
        .where(inArray(schema.mailDeliveryEvents.id, sendDeliveryEventIds));
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
    const linkedDeliveryIngestion = await db
      .select({
        ingestionEventId: schema.mailDeliveryIngestionEvents.ingestionEventId,
      })
      .from(schema.mailDeliveryIngestionEvents)
      .where(
        inArray(schema.mailDeliveryIngestionEvents.outboundRevisionId, revisionIds),
      );
    const linkedIngestionIds = linkedDeliveryIngestion.map(
      (row) => row.ingestionEventId,
    );
    if (linkedIngestionIds.length) {
      await db
        .delete(schema.mailDeliveryIngestionEvents)
        .where(
          inArray(
            schema.mailDeliveryIngestionEvents.ingestionEventId,
            linkedIngestionIds,
          ),
        );
      await db
        .delete(schema.mailProviderIngestionEvents)
        .where(inArray(schema.mailProviderIngestionEvents.id, linkedIngestionIds));
    }

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
    await db.delete(schema.mailDrafts).where(inArray(schema.mailDrafts.id, draftIds));
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
          inArray(
            schema.mailSignatureVersionAssets.signatureVersionId,
            signatureVersionIds,
          ),
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

  await db.delete(schema.mailCompanyConfig);

  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);

  if (mailboxIds.length) {
    const orphanInbound = await db
      .select({ ingestionEventId: schema.mailInboundIngestionEvents.ingestionEventId })
      .from(schema.mailInboundIngestionEvents)
      .where(
        or(
          inArray(schema.mailInboundIngestionEvents.routeOwnerMailboxId, mailboxIds),
          inArray(schema.mailInboundIngestionEvents.resolvedFallbackMailboxId, mailboxIds),
        ),
      );
    const orphanInboundIds = orphanInbound.map((row) => row.ingestionEventId);
    if (orphanInboundIds.length) {
      await db
        .delete(schema.mailInboundIngestionEvents)
        .where(
          inArray(schema.mailInboundIngestionEvents.ingestionEventId, orphanInboundIds),
        );
      await db
        .delete(schema.mailDeliveryIngestionEvents)
        .where(
          inArray(schema.mailDeliveryIngestionEvents.ingestionEventId, orphanInboundIds),
        );
      await db
        .delete(schema.mailProviderIngestionEvents)
        .where(inArray(schema.mailProviderIngestionEvents.id, orphanInboundIds));
    }

    const fixtureMessages = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(inArray(schema.mailMessages.mailboxId, mailboxIds));
    const fixtureMessageIds = fixtureMessages.map((row) => row.id);
    if (fixtureMessageIds.length) {
      await deleteMessagesByIds(db, fixtureMessageIds);
    }

    await db
      .delete(schema.mailThreads)
      .where(inArray(schema.mailThreads.mailboxId, mailboxIds));

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

async function quarantineProcessingProviderEvent(
  db: TestDb,
  ingestionEventId: string,
  quarantineReason: string,
) {
  const [provider] = await db
    .select()
    .from(schema.mailProviderIngestionEvents)
    .where(eq(schema.mailProviderIngestionEvents.id, ingestionEventId))
    .limit(1);
  assert.ok(provider);
  assert.equal(provider.status, "pending");

  const processingVersion = await claimProviderIngestionForProcessing(db, {
    ingestionEventId,
    expectedProcessingVersion: provider.processingVersion,
  });
  const now = new Date().toISOString();
  await runGuardedUpdate(
    db,
    buildInboundProviderQuarantineUpdate(db, {
      ingestionEventId,
      processingProcessingVersion: processingVersion,
      nextProcessingVersion: processingVersion + 1,
      finalizedAt: now,
      quarantineReason,
    }),
    "quarantine setup",
  );
}

async function setupAdminComposeFixture(db: TestDb, fixtureSuffix = "") {
  const address = fixtureAddress(`compose${fixtureSuffix}`);
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
    id: `${FIXTURE}-member${fixtureSuffix}`,
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
  recipients: Array<{ recipientType: "to" | "cc" | "bcc"; address: string }>,
  fixtureSuffix = "",
) {
  const { mailbox, identity } = await setupAdminComposeFixture(db, fixtureSuffix);
  const created = await createDraft(db, adminActor, {
    senderIdentityId: identity.id,
    mailboxId: mailbox.id,
    subject: "Replay delivery test",
    bodyText: "Body",
  });
  assert.ok(created.created);
  let draft: DraftDetailView = created.item;
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
  return { revision };
}

async function acceptSend(
  db: TestDb,
  revisionId: string,
  providerMessageId: string,
) {
  const initiated = await initiateAdminDirectSend(db, adminActor, {
    revisionId,
    idempotencyKey: `${FIXTURE}-send-${revisionId}-${providerMessageId}`,
  });
  const transport = new FakeMailTransportAdapter().setBehavior({
    outcome: "accepted",
    providerRequestId: `${FIXTURE}-req`,
    providerMessageId,
  });
  await dispatchSendOperation(db, adminActor, {
    sendOperationId: initiated.id,
    expectedOrchestrationVersion: initiated.orchestrationVersion,
    adapter: transport,
  });
  return initiated;
}

describe("0065 processing lease schema inspection", () => {
  it("0065 enables durable stale processing detection", () => {
    assert.equal(
      STUCK_PROCESSING_RECOVERY_SCHEMA_GAP.safeStaleProcessingDetectionRepresentable,
      true,
    );
    assert.equal(
      STUCK_PROCESSING_RECOVERY_SCHEMA_GAP.stuckProcessingRecoveryImplemented,
      true,
    );
    assert.equal(
      STUCK_PROCESSING_RECOVERY_SCHEMA_GAP.requiresSchemaEvolution,
      false,
    );
  });
});

describe("quarantine replay Local D1", () => {
  let db: TestDb;
  let payloadStore: MemoryInboundRawPayloadStore;
  let attachmentStore: MemoryInboundAttachmentStore;
  let dispose: (() => void) | undefined;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    payloadStore = new MemoryInboundRawPayloadStore();
    attachmentStore = new MemoryInboundAttachmentStore();
    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("authorization: delivery_health and super_admin may replay; others forbidden", async () => {
    assert.doesNotThrow(() => assertMailDeliveryHealth(deliveryHealthActor));
    assert.doesNotThrow(() => assertMailDeliveryHealth(superAdminActor));
    assert.throws(() => assertMailDeliveryHealth(accountMgmtActor));
    assert.throws(() => assertMailDeliveryHealth(approvalReviewActor));
    assert.throws(() => assertMailDeliveryHealth(globalMailReadActor));
    assert.throws(() => assertMailDeliveryHealth(ordinaryStaffActor));
    assert.throws(() => assertMailDeliveryHealth(adminActor));
  });

  it("null route replay freezes fallback A — config drift to B does not retarget", async () => {
    await cleanupFixtures(db);
    const archivedId = `${FIXTURE}-drift-archived`;
    const fallbackA = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("fallback-a"),
      mailboxType: "shared",
    });
    const fallbackB = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("fallback-b"),
      mailboxType: "shared",
    });
    await insertFixtureMailbox(db, {
      id: archivedId,
      address: fixtureAddress("drift-archived-addr"),
      status: "archived",
    });
    const raAddress = fixtureAddress("drift-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-drift`,
      mailboxId: archivedId,
      address: raAddress,
      status: "suspended",
    });

    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-drift-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: sampleMime(),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;
    assert.equal(
      staged.envelopeResults[0]!.quarantineReason,
      INBOUND_QUARANTINE_REASONS.fallbackNotConfigured,
    );

    await setInboundFallbackMailbox(db, superAdminActor, {
      mailboxId: fallbackA.id,
    });

    const replayed = await replayQuarantinedIngestionEvent(db, deliveryHealthActor, {
      ingestionEventId: eventId,
    });
    assert.equal(replayed.outcome, "REPLAYED");
    assert.equal(replayed.routeMode, "fallback");
    assert.equal(replayed.frozenFallbackMailboxId, fallbackA.id);

    await setInboundFallbackMailbox(db, superAdminActor, {
      mailboxId: fallbackB.id,
    });

    const [inboundChild] = await db
      .select()
      .from(schema.mailInboundIngestionEvents)
      .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, eventId));
    assert.equal(inboundChild?.resolvedFallbackMailboxId, fallbackA.id);
    assert.notEqual(inboundChild?.resolvedFallbackMailboxId, fallbackB.id);
  });

  it("existing fallback snapshot preserved — replay does not retarget to live fallback B", async () => {
    await cleanupFixtures(db);
    const archivedId = `${FIXTURE}-snap-archived`;
    const fallbackA = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("snap-fallback-a"),
      mailboxType: "shared",
    });
    const fallbackB = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("snap-fallback-b"),
      mailboxType: "shared",
    });
    await setInboundFallbackMailbox(db, superAdminActor, {
      mailboxId: fallbackA.id,
    });
    await insertFixtureMailbox(db, {
      id: archivedId,
      address: fixtureAddress("snap-archived-addr"),
      status: "archived",
    });
    const raAddress = fixtureAddress("snap-route");
    await insertReceivingAddress(db, {
      id: `${FIXTURE}-ra-snap`,
      mailboxId: archivedId,
      address: raAddress,
      status: "suspended",
    });

    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-snap-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<snap@external.test>" }),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;
    assert.equal(staged.envelopeResults[0]!.resolvedFallbackMailboxId, fallbackA.id);

    await db
      .update(schema.mailMailboxes)
      .set({ status: "suspended", updatedAt: new Date().toISOString() })
      .where(eq(schema.mailMailboxes.id, fallbackA.id));

    await quarantineProcessingProviderEvent(
      db,
      eventId,
      INBOUND_QUARANTINE_REASONS.materializationTargetUnusable,
    );

    await db
      .update(schema.mailMailboxes)
      .set({ status: "active", updatedAt: new Date().toISOString() })
      .where(eq(schema.mailMailboxes.id, fallbackA.id));

    await setInboundFallbackMailbox(db, superAdminActor, {
      mailboxId: fallbackB.id,
    });

    const replayed = await replayQuarantinedIngestionEvent(db, superAdminActor, {
      ingestionEventId: eventId,
    });
    assert.equal(replayed.outcome, "REPLAYED");

    const [inboundChild] = await db
      .select()
      .from(schema.mailInboundIngestionEvents)
      .where(eq(schema.mailInboundIngestionEvents.ingestionEventId, eventId));
    assert.equal(inboundChild?.resolvedRouteMode, "fallback");
    assert.equal(inboundChild?.resolvedFallbackMailboxId, fallbackA.id);
    assert.notEqual(inboundChild?.resolvedFallbackMailboxId, fallbackB.id);
  });

  it("unknown address replay resolves route after Receiving Address created", async () => {
    await cleanupFixtures(db);
    const raAddress = fixtureAddress("unknown-replay");
    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-unknown-replay-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<unknown-replay@external.test>" }),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;
    const providerIdBefore = eventId;
    const [providerBefore] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    const payloadKeyBefore = providerBefore?.payloadStorageKey;
    const payloadHashBefore = providerBefore?.payloadContentHash;

    await createMailbox(db, superAdminActor, {
      address: raAddress,
      mailboxType: "shared",
    });

    const replayed = await replayQuarantinedIngestionEvent(db, deliveryHealthActor, {
      ingestionEventId: eventId,
    });
    assert.equal(replayed.outcome, "REPLAYED");
    assert.equal(replayed.routeMode, "direct");

    const [providerAfter] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(providerAfter?.id, providerIdBefore);
    assert.equal(providerAfter?.status, "pending");
    assert.equal(providerAfter?.payloadStorageKey, payloadKeyBefore);
    assert.equal(providerAfter?.payloadContentHash, payloadHashBefore);
    assert.ok((providerAfter?.processingVersion ?? 0) > (providerBefore?.processingVersion ?? 0));

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.ingestionQuarantineReplayed),
          eq(schema.auditLogs.entityId, eventId),
        ),
      );
    assert.equal(audits.length, 1);
  });

  it("still-broken unknown address leaves event quarantined without version mutation", async () => {
    await cleanupFixtures(db);
    const raAddress = fixtureAddress("still-unknown");
    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-still-unknown-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<still-unknown@external.test>" }),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;
    const [providerBefore] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    const versionBefore = providerBefore!.processingVersion;

    const result = await replayQuarantinedIngestionEvent(db, deliveryHealthActor, {
      ingestionEventId: eventId,
    });
    assert.equal(result.outcome, "REPLAY_NOT_READY");
    assert.equal(result.processingVersion, versionBefore);

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(provider?.status, "quarantined");
    assert.equal(provider?.processingVersion, versionBefore);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.ingestionQuarantineReplayed));
    assert.equal(audits.length, 0);
  });

  it("non-replayable integrity quarantine refused even for super_admin", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("integrity"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    const collisionId = "<integrity-collision@external.test>";
    const first = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-collision-a`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: collisionId, subject: "One" }),
      envelopeRecipients: [primary!.address],
    });
    await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: first.envelopeResults[0]!.ingestionEventId },
    );

    const second = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-collision-b`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: collisionId, subject: "Two" }),
      envelopeRecipients: [primary!.address],
    });
    const eventId = second.envelopeResults[0]!.ingestionEventId;

    await quarantineProcessingProviderEvent(
      db,
      eventId,
      INBOUND_QUARANTINE_REASONS.rfcMessageIdCollision,
    );

    const result = await replayQuarantinedIngestionEvent(db, superAdminActor, {
      ingestionEventId: eventId,
    });
    assert.equal(result.outcome, "REPLAY_REFUSED");

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(provider?.status, "quarantined");
    assert.equal(
      provider?.quarantineReason,
      INBOUND_QUARANTINE_REASONS.rfcMessageIdCollision,
    );
  });

  it("delivery replay resolves exact correlation after send becomes accepted", async () => {
    await cleanupFixtures(db);
    const providerMessageId = `${FIXTURE}-msg-delivery-replay`;
    const recipient = "delivery-replay@example.com";

    const staged = await stageDeliveryProviderEvent(db, null, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-delivery-replay-evt`,
      providerMessageId,
      recipientAddress: recipient,
      deliveryEventType: "delivered",
      receivedAt: RECEIVED_AT,
    });
    assert.equal(staged.providerStatus, "pending");
    assert.equal(staged.correlation, null);

    await quarantineProcessingProviderEvent(
      db,
      staged.ingestionEventId,
      DELIVERY_QUARANTINE_REASONS.correlationUnresolved,
    );

    const { revision } = await createDraftWithRecipients(
      db,
      [{ recipientType: "to", address: recipient }],
      "-delivery-replay",
    );
    await acceptSend(db, revision.id, providerMessageId);

    const replayed = await replayQuarantinedIngestionEvent(db, deliveryHealthActor, {
      ingestionEventId: staged.ingestionEventId,
    });
    assert.equal(replayed.outcome, "REPLAYED");

    const [deliveryChild] = await db
      .select()
      .from(schema.mailDeliveryIngestionEvents)
      .where(
        eq(
          schema.mailDeliveryIngestionEvents.ingestionEventId,
          staged.ingestionEventId,
        ),
      );
    assert.ok(deliveryChild?.sendOperationId);
    assert.ok(deliveryChild?.transportAttemptId);
    assert.ok(deliveryChild?.outboundRevisionRecipientId);
    assert.ok(deliveryChild?.correlatedAt);

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, staged.ingestionEventId));
    assert.equal(provider?.status, "pending");
  });

  it("completed ingestion cannot be replayed", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, superAdminActor, {
      address: fixtureAddress("completed"),
      mailboxType: "shared",
    });
    const [primary] = await db
      .select()
      .from(schema.mailReceivingAddresses)
      .where(eq(schema.mailReceivingAddresses.mailboxId, mailbox.id));

    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-completed-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<completed@external.test>" }),
      envelopeRecipients: [primary!.address],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;
    await materializeInboundIngestionEvent(
      db,
      { rawPayloadStore: payloadStore, attachmentStore },
      { ingestionEventId: eventId },
    );

    await assert.rejects(
      () =>
        replayQuarantinedIngestionEvent(db, deliveryHealthActor, {
          ingestionEventId: eventId,
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        /completed ingestion cannot be replayed/i.test(error.message),
    );
  });

  it("concurrent replay allows at most one successful transition", async () => {
    await cleanupFixtures(db);
    const raAddress = fixtureAddress("concurrent-replay");
    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-concurrent-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<concurrent@external.test>" }),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;
    await createMailbox(db, superAdminActor, {
      address: raAddress,
      mailboxType: "shared",
    });

    const settled = await Promise.allSettled([
      replayQuarantinedIngestionEvent(db, deliveryHealthActor, {
        ingestionEventId: eventId,
      }),
      replayQuarantinedIngestionEvent(db, deliveryHealthActor, {
        ingestionEventId: eventId,
      }),
    ]);

    const replayed = settled.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof replayQuarantinedIngestionEvent>>> =>
        result.status === "fulfilled" && result.value.outcome === "REPLAYED",
    );
    const rejected = settled.filter((result) => result.status === "rejected");
    assert.equal(replayed.length, 1);
    assert.equal(rejected.length, 1);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, MAIL_AUDIT_ACTIONS.ingestionQuarantineReplayed),
          eq(schema.auditLogs.entityId, eventId),
        ),
      );
    assert.equal(audits.length, 1);

    const [provider] = await db
      .select()
      .from(schema.mailProviderIngestionEvents)
      .where(eq(schema.mailProviderIngestionEvents.id, eventId));
    assert.equal(provider?.status, "pending");
  });

  it("list quarantined ingestion events returns safe metadata only", async () => {
    await cleanupFixtures(db);
    const raAddress = fixtureAddress("list-quarantine");
    await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-list-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<list@external.test>" }),
      envelopeRecipients: [raAddress],
    });

    const items = await listQuarantinedIngestionEvents(db, deliveryHealthActor, {
      eventKind: "inbound_message",
    });
    const match = items.find((item) => item.quarantineReason === "unknown_receiving_address");
    assert.ok(match);
    assert.equal(match.replayable, true);
    assert.equal(match.replayClassification, "replayable_after_external_state_change");
    assert.equal("payloadStorageKey" in match, false);
  });

  it("replay rejected for unauthorized actors", async () => {
    await cleanupFixtures(db);
    const raAddress = fixtureAddress("auth-deny");
    const staged = await stageInboundProviderEvent(db, payloadStore, {
      provider: PROVIDER,
      providerEventId: `${FIXTURE}-auth-deny-evt`,
      receivedAt: RECEIVED_AT,
      rawPayloadBytes: buildMime({ messageId: "<auth-deny@external.test>" }),
      envelopeRecipients: [raAddress],
    });
    const eventId = staged.envelopeResults[0]!.ingestionEventId;

    for (const deniedActor of [
      accountMgmtActor,
      approvalReviewActor,
      globalMailReadActor,
      ordinaryStaffActor,
      adminActor,
    ]) {
      await assert.rejects(
        () =>
          replayQuarantinedIngestionEvent(db, deniedActor, {
            ingestionEventId: eventId,
          }),
        (error: unknown) =>
          error instanceof MailServiceError && error.status === 403,
      );
    }
  });
});
