import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  addDraftAttachment,
  removeDraftAttachment,
} from "@/lib/mail/draft-attachment-service";
import { createDraft, updateDraft } from "@/lib/mail/draft-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { MemoryOutboundAttachmentStore } from "@/lib/mail/outbound-attachment-store";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  createOutboundRevisionFromDraft,
  recomputeOutboundRevisionContentHash,
} from "@/lib/mail/outbound-revision-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-phase2f3b-att";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  grants: MailAdminPermission[] = [
    "account_mgmt",
    "address_assignment",
    "signature_template",
  ],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2f3b-att-test" },
  };
}

const staffActor = actor(SEED_IDS.staffA, []);
const adminActor = actor(SEED_IDS.admin);

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

  const drafts =
    identityIds.length > 0
      ? await db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.senderIdentityId, identityIds))
      : [];
  const draftIds = drafts.map((row) => row.id);

  const revisionConditions = [
    ...(draftIds.length
      ? [inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds)]
      : []),
    ...(identityIds.length
      ? [inArray(schema.mailOutboundRevisions.senderIdentityId, identityIds)]
      : []),
  ];
  const revisions =
    revisionConditions.length > 0
      ? await db
          .select({ id: schema.mailOutboundRevisions.id })
          .from(schema.mailOutboundRevisions)
          .where(or(...revisionConditions))
      : [];
  const revisionIds = revisions.map((row) => row.id);

  if (revisionIds.length) {
    await db
      .delete(schema.mailOutboundRevisionAttachments)
      .where(
        inArray(schema.mailOutboundRevisionAttachments.revisionId, revisionIds),
      );
    await db
      .delete(schema.mailOutboundRevisionRecipients)
      .where(
        inArray(schema.mailOutboundRevisionRecipients.revisionId, revisionIds),
      );
    await db
      .delete(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.id, revisionIds));
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
    const snapshotRows = await db
      .select({ id: schema.mailSignatureSnapshots.id })
      .from(schema.mailSignatureSnapshots)
      .where(inArray(schema.mailSignatureSnapshots.senderIdentityId, identityIds));
    const snapshotIds = snapshotRows.map((row) => row.id);
    if (snapshotIds.length) {
      await db
        .delete(schema.mailSignatureSnapshotAssets)
        .where(inArray(schema.mailSignatureSnapshotAssets.signatureSnapshotId, snapshotIds));
      await db
        .delete(schema.mailSignatureSnapshots)
        .where(inArray(schema.mailSignatureSnapshots.id, snapshotIds));
    }

    const versionRows = await db
      .select({ id: schema.mailSignatureVersions.id })
      .from(schema.mailSignatureVersions)
      .where(inArray(schema.mailSignatureVersions.senderIdentityId, identityIds));
    const versionIds = versionRows.map((row) => row.id);
    if (versionIds.length) {
      await db
        .delete(schema.mailSignatureVersionAssets)
        .where(inArray(schema.mailSignatureVersionAssets.signatureVersionId, versionIds));
      await db
        .delete(schema.mailSignatureVersions)
        .where(inArray(schema.mailSignatureVersions.id, versionIds));
    }

    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(
        inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds),
      );
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
  await db
    .update(schema.mailMailboxMembers)
    .set({ canRead: 1, canReply: 1, canSend: 1, updatedAt: now })
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailbox.id),
        eq(schema.mailMailboxMembers.userId, SEED_IDS.staffA),
      ),
    );

  return { mailbox, identity };
}

async function createSendReadyDraft(db: TestDb) {
  const { mailbox, identity } = await setupComposeFixture(db);
  const created = await createDraft(db, staffActor, {
    senderIdentityId: identity.id,
    mailboxId: mailbox.id,
    subject: "Attachment test",
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

describe("draft attachment pipeline integration", () => {
  let db: TestDb;
  let dispose: (() => void) | undefined;
  const attachmentStore = new MemoryOutboundAttachmentStore();

  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await enableMailAccess(db, SEED_IDS.admin);
    await enableMailAccess(db, SEED_IDS.staffA);
    await cleanupFixtures(db);
  });

  after(async () => {
    try {
      await cleanupFixtures(db);
    } finally {
      await dispose?.();
    }
  });

  it("binds uploaded attachments to drafts and bumps autosave version", async () => {
    await cleanupFixtures(db);
    const draft = await createSendReadyDraft(db);
    const bytes = new TextEncoder().encode("hello attachment");

    const withAttachment = await addDraftAttachment(
      db,
      staffActor,
      attachmentStore,
      {
        draftId: draft.id,
        expectedAutosaveVersion: draft.autosaveVersion,
        bytes,
        originalFilename: "hello.txt",
        mimeType: "text/plain",
      },
    );

    assert.equal(withAttachment.autosaveVersion, draft.autosaveVersion + 1);
    assert.equal(withAttachment.attachments.length, 1);
    assert.equal(withAttachment.attachments[0]?.displayFilename, "hello.txt");
    assert.equal(withAttachment.attachments[0]?.deliveryMode, "attachment");
    assert.equal(withAttachment.attachments[0]?.sizeBytes, bytes.byteLength);
    assert.match(withAttachment.attachments[0]?.contentHash ?? "", /^[a-f0-9]{64}$/);
  });

  it("freezes attachment snapshot on revision and preserves hash after draft mutation", async () => {
    await cleanupFixtures(db);
    const draft = await createSendReadyDraft(db);
    const bytes = new TextEncoder().encode("revision snapshot bytes");

    const withAttachment = await addDraftAttachment(
      db,
      staffActor,
      attachmentStore,
      {
        draftId: draft.id,
        expectedAutosaveVersion: draft.autosaveVersion,
        bytes,
        originalFilename: "snapshot.txt",
        mimeType: "text/plain",
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
    assert.equal(revisionAttachments.length, 1);
    assert.equal(revisionAttachments[0]?.displayFilename, "snapshot.txt");
    const frozenHash = revisionAttachments[0]?.contentHash;

    const removed = await removeDraftAttachment(db, staffActor, {
      draftId: withAttachment.id,
      attachmentId: withAttachment.attachments[0]!.id,
      expectedAutosaveVersion: withAttachment.autosaveVersion,
    });
    assert.equal(removed.attachments.length, 0);

    const recomputed = await recomputeOutboundRevisionContentHash(db, revision.id);
    assert.equal(recomputed.contentHash, revision.contentHash);
    assert.equal(revisionAttachments[0]?.contentHash, frozenHash);

    await updateDraft(db, staffActor, {
      draftId: removed.id,
      expectedAutosaveVersion: removed.autosaveVersion,
      subject: "Changed after freeze",
    });
  });
});
