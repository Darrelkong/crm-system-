import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  addDraftAttachment,
  removeDraftAttachment,
} from "@/lib/mail/draft-attachment-service";
import { createDraft } from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import { grantMailAdminPermission, findActiveAdminGrant } from "@/lib/mail/mail-admin-grant-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { MemoryOutboundAttachmentStore } from "@/lib/mail/outbound-attachment-store";
import { submitRevisionForApproval } from "@/lib/mail/outbound-approval-service";
import { resolveDownloadableOutboundRevisionAttachment } from "@/lib/mail/outbound-revision-attachment-download-service";
import {
  createOutboundRevisionFromDraft,
  getOutboundRevision,
} from "@/lib/mail/outbound-revision-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";
import {
  assertStoredFileRelationshipIntegrity,
} from "@/lib/mail/mail-attachment-download-service";

const FIXTURE = "mail-phase6n6b1-rev-att";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailAdminPermission[] = [],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase6n6b1-rev-att-test" },
  };
}

const staffActor = actor(SEED_IDS.staffA, []);
const reviewerActor = actor(SEED_IDS.staffB, ["approval_review"]);
const outsiderActor = actor(SEED_IDS.staffB, []);
const adminActor = actor(SEED_IDS.admin, ["permission_mgmt"]);

function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
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
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
  const identityIds = identities.map((row) => row.id);

  const draftsByIdentity =
    identityIds.length > 0
      ? await db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.senderIdentityId, identityIds))
      : [];
  const draftsByMailbox =
    mailboxIds.length > 0
      ? await db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.mailboxId, mailboxIds))
      : [];
  const draftIds = [
    ...new Set([
      ...draftsByIdentity.map((row) => row.id),
      ...draftsByMailbox.map((row) => row.id),
    ]),
  ];

  const revisionsByDraft =
    draftIds.length > 0
      ? await db
          .select({
            id: schema.mailOutboundRevisions.id,
            revisionChainId: schema.mailOutboundRevisions.revisionChainId,
            signatureSnapshotId: schema.mailOutboundRevisions.signatureSnapshotId,
          })
          .from(schema.mailOutboundRevisions)
          .where(inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds))
      : [];
  const revisionsByIdentity =
    identityIds.length > 0
      ? await db
          .select({
            id: schema.mailOutboundRevisions.id,
            revisionChainId: schema.mailOutboundRevisions.revisionChainId,
            signatureSnapshotId: schema.mailOutboundRevisions.signatureSnapshotId,
          })
          .from(schema.mailOutboundRevisions)
          .where(inArray(schema.mailOutboundRevisions.senderIdentityId, identityIds))
      : [];
  const revisions = [
    ...new Map(
      [...revisionsByDraft, ...revisionsByIdentity].map((row) => [row.id, row]),
    ).values(),
  ];
  const revisionIds = revisions.map((row) => row.id);
  const chainIds = [...new Set(revisions.map((row) => row.revisionChainId))];
  const snapshotIdsFromRevisions = revisions.map((row) => row.signatureSnapshotId);
  const snapshotsByIdentity =
    identityIds.length > 0
      ? await db
          .select({ id: schema.mailSignatureSnapshots.id })
          .from(schema.mailSignatureSnapshots)
          .where(inArray(schema.mailSignatureSnapshots.senderIdentityId, identityIds))
      : [];
  const snapshotIds = [
    ...new Set([
      ...snapshotIdsFromRevisions,
      ...snapshotsByIdentity.map((row) => row.id),
    ]),
  ];

  const sendOps = revisionIds.length
    ? await db
        .select({ id: schema.mailSendOperations.id })
        .from(schema.mailSendOperations)
        .where(inArray(schema.mailSendOperations.outboundRevisionId, revisionIds))
    : [];
  const sendIds = sendOps.map((row) => row.id);

  if (sendIds.length) {
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

  if (chainIds.length) {
    await db
      .delete(schema.mailOutboundApprovalEvents)
      .where(inArray(schema.mailOutboundApprovalEvents.revisionChainId, chainIds));
    await db
      .delete(schema.mailOutboundApprovals)
      .where(inArray(schema.mailOutboundApprovals.revisionChainId, chainIds));
  }

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
      .delete(schema.mailDraftAttachments)
      .where(inArray(schema.mailDraftAttachments.draftId, draftIds));
    await db
      .delete(schema.mailDraftRecipients)
      .where(inArray(schema.mailDraftRecipients.draftId, draftIds));
    await db
      .delete(schema.mailDrafts)
      .where(inArray(schema.mailDrafts.id, draftIds));
  }

  if (identityIds.length) {
    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSignatureVersions)
      .where(inArray(schema.mailSignatureVersions.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

  if (mailboxIds.length) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));
    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }
}

async function setupComposeFixture(db: TestDb) {
  const address = fixtureAddress("compose");
  const mailbox = await createMailbox(db, adminActor, {
    address,
    mailboxType: "personal",
    ownerUserId: SEED_IDS.staffA,
  });
  const identity = await createSenderIdentity(db, adminActor, {
    address,
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, adminActor, {
    senderIdentityId: identity.id,
    targetUserId: SEED_IDS.staffA,
    canSend: true,
  });

  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: `${FIXTURE}-member`,
    mailboxId: mailbox.id,
    userId: SEED_IDS.staffA,
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

async function createSendReadyDraft(
  db: TestDb,
  mailboxId: string,
  identityId: string,
) {
  const created = await createDraft(db, staffActor, {
    senderIdentityId: identityId,
    mailboxId,
    subject: "Attachment approval test",
    bodyText: "Body",
    bodyHtml: "<p>Body</p>",
    recipients: [
      {
        recipientType: "to",
        address: fixtureAddress("recipient"),
      },
    ],
  });
  assert.equal(created.created, true);
  assert.ok(created.item);
  return created.item!;
}

async function createFrozenRevisionWithAttachment(
  db: TestDb,
  attachmentStore: MemoryOutboundAttachmentStore,
  mailboxId: string,
  identityId: string,
  input?: {
    filename?: string;
    mimeType?: string;
    bytes?: Uint8Array;
    scanStatus?: "clean" | "blocked" | "scan_failed";
  },
) {
  const draft = await createSendReadyDraft(db, mailboxId, identityId);
  const bytes =
    input?.bytes ?? new TextEncoder().encode("frozen revision attachment bytes");
  const withAttachment = await addDraftAttachment(
    db,
    staffActor,
    attachmentStore,
    {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      bytes,
      originalFilename: input?.filename ?? "review-me.pdf",
      mimeType: input?.mimeType ?? "application/pdf",
    },
  );

  const revision = await createOutboundRevisionFromDraft(db, staffActor, {
    draftId: withAttachment.id,
    expectedAutosaveVersion: withAttachment.autosaveVersion,
  });

  const revisionAttachments = await db
    .select()
    .from(schema.mailOutboundRevisionAttachments)
    .where(eq(schema.mailOutboundRevisionAttachments.revisionId, revision.id));

  if (input?.scanStatus && input.scanStatus !== "clean") {
    const storedFileId = revisionAttachments[0]?.storedFileId;
    if (storedFileId) {
      await db
        .update(schema.mailStoredFiles)
        .set({
          securityScanStatus: input.scanStatus,
          securityScannedAt: new Date().toISOString(),
        })
        .where(eq(schema.mailStoredFiles.id, storedFileId));
    }
  }

  await submitRevisionForApproval(db, staffActor, { revisionId: revision.id });

  return {
    revision,
    attachment: revisionAttachments[0]!,
    bytes,
    filename: input?.filename ?? "review-me.pdf",
    mimeType: input?.mimeType ?? "application/pdf",
  };
}

describe("stored file integrity", () => {
  it("denies download when stored file hash relationship is invalid", () => {
    assert.throws(
      () =>
        assertStoredFileRelationshipIntegrity(
          { storedFileId: "file-a", contentHash: "a".repeat(64) },
          { id: "file-a", contentHash: "b".repeat(64) },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });
});

describe("outbound revision attachment download integration", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const attachmentStore = new MemoryOutboundAttachmentStore();
  let composeMailboxId: string;
  let composeIdentityId: string;

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    await cleanupFixtures(db);
    const existingGrant = await findActiveAdminGrant(
      db,
      SEED_IDS.staffB,
      "approval_review",
    );
    if (!existingGrant) {
      await grantMailAdminPermission(db, adminActor, {
        targetUserId: SEED_IDS.staffB,
        permission: "approval_review",
      });
    }
    const { mailbox, identity } = await setupComposeFixture(db);
    composeMailboxId = mailbox.id;
    composeIdentityId = identity.id;
  });

  after(async () => {
    dispose?.();
  });

  it("enforces frozen revision attachment download authorization end-to-end", async () => {
    const downloadable = await createFrozenRevisionWithAttachment(
      db,
      attachmentStore,
      composeMailboxId,
      composeIdentityId,
      {
      filename: "frozen-meta.txt",
      mimeType: "text/plain",
    },
    );

    const resolved = await resolveDownloadableOutboundRevisionAttachment(
      db,
      reviewerActor,
      downloadable.revision.id,
      downloadable.attachment.id,
    );
    assert.equal(resolved.attachmentId, downloadable.attachment.id);
    assert.equal(resolved.revisionId, downloadable.revision.id);
    assert.equal(resolved.filename, downloadable.filename);
    assert.equal(resolved.mimeType, downloadable.mimeType);
    assert.equal(resolved.sizeBytes, downloadable.attachment.sizeBytes);
    assert.match(resolved.storageKey, /^mail\//);

    const detail = await getOutboundRevision(db, reviewerActor, downloadable.revision.id);
    assert.equal(detail.attachments.length, 1);
    assert.equal(detail.attachments[0]?.id, downloadable.attachment.id);
    assert.equal(detail.attachments[0]?.displayFilename, downloadable.filename);
    assert.equal(detail.attachments[0]?.mimeType, downloadable.mimeType);
    assert.equal(detail.attachments[0]?.sizeBytes, downloadable.attachment.sizeBytes);
    assert.equal(detail.attachments[0]?.downloadAvailable, true);
    assert.equal(Object.hasOwn(detail.attachments[0] ?? {}, "storageKey"), false);

    const secondDraft = await createSendReadyDraft(
      db,
      composeMailboxId,
      composeIdentityId,
    );
    const secondRevision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: secondDraft.id,
      expectedAutosaveVersion: secondDraft.autosaveVersion,
    });
    await assert.rejects(
      () =>
        resolveDownloadableOutboundRevisionAttachment(
          db,
          reviewerActor,
          secondRevision.id,
          downloadable.attachment.id,
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );

    await assert.rejects(
      () =>
        resolveDownloadableOutboundRevisionAttachment(
          db,
          outsiderActor,
          downloadable.revision.id,
          downloadable.attachment.id,
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 403,
    );

    await assert.rejects(
      () =>
        resolveDownloadableOutboundRevisionAttachment(
          db,
          reviewerActor,
          downloadable.revision.id,
          `${FIXTURE}-missing-attachment`,
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );

    const blockedScan = await createFrozenRevisionWithAttachment(
      db,
      attachmentStore,
      composeMailboxId,
      composeIdentityId,
      {
      scanStatus: "blocked",
    },
    );
    const blockedScanDetail = await getOutboundRevision(
      db,
      reviewerActor,
      blockedScan.revision.id,
    );
    assert.equal(blockedScanDetail.attachments[0]?.downloadAvailable, false);
    await assert.rejects(
      () =>
        resolveDownloadableOutboundRevisionAttachment(
          db,
          reviewerActor,
          blockedScan.revision.id,
          blockedScan.attachment.id,
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );

    const draft = await createSendReadyDraft(
      db,
      composeMailboxId,
      composeIdentityId,
    );
    const bytes = new TextEncoder().encode("snapshot-only-on-revision");
    const withAttachment = await addDraftAttachment(
      db,
      staffActor,
      attachmentStore,
      {
        draftId: draft.id,
        expectedAutosaveVersion: draft.autosaveVersion,
        bytes,
        originalFilename: "snapshot-only.txt",
        mimeType: "text/plain",
      },
    );
    const frozenRevision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: withAttachment.id,
      expectedAutosaveVersion: withAttachment.autosaveVersion,
    });
    await submitRevisionForApproval(db, staffActor, {
      revisionId: frozenRevision.id,
    });
    const removed = await removeDraftAttachment(db, staffActor, {
      draftId: withAttachment.id,
      attachmentId: withAttachment.attachments[0]!.id,
      expectedAutosaveVersion: withAttachment.autosaveVersion,
    });
    assert.equal(removed.attachments.length, 0);
    const frozenDetail = await getOutboundRevision(db, reviewerActor, frozenRevision.id);
    assert.equal(frozenDetail.attachments.length, 1);
    assert.equal(frozenDetail.attachments[0]?.displayFilename, "snapshot-only.txt");
    assert.equal(frozenDetail.attachments[0]?.sizeBytes, bytes.byteLength);
  });
});
