import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { assertCanComposeFromIdentityInMailbox } from "@/lib/mail/compose-authorization";
import { MailServiceError } from "@/lib/mail/errors";
import {
  addDraftRecipient,
  createDraft,
  getDraft,
  updateDraft,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { grantSenderIdentityAccess, revokeSenderIdentityGrant } from "@/lib/mail/sender-identity-grant-service";
import { assertHasSenderIdentitySendGrant } from "@/lib/mail/sender-identity-send-auth";
import { createSenderIdentity, suspendSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  activateSignatureVersion,
  createSignatureVersion,
} from "@/lib/mail/signature-service";
import {
  createOutboundRevisionFromDraft,
  recomputeOutboundRevisionContentHash,
} from "@/lib/mail/outbound-revision-service";
import { runMailBatch, buildDraftVersionGuardedAuditInsert } from "@/lib/mail/guarded-batch";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-phase2c5";

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
    crmRole: "staff",
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2c5-test" },
  };
}

const adminActor = actor(SEED_IDS.admin);
const staffActor = actor(SEED_IDS.staffA, []);
const superAdminActor = actor(SEED_IDS.admin, ["super_admin"]);

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
  const revisions = draftIds.length
    ? await db
        .select({ id: schema.mailOutboundRevisions.id })
        .from(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds))
    : [];

  const revisionIds = revisions.map((row) => row.id);
  const snapshots = revisionIds.length
    ? await db
        .select({ id: schema.mailOutboundRevisions.signatureSnapshotId })
        .from(schema.mailOutboundRevisions)
        .where(inArray(schema.mailOutboundRevisions.id, revisionIds))
    : [];
  const snapshotIds = snapshots.map((row) => row.id);

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

  if (snapshotIds.length) {
    await db
      .delete(schema.mailSignatureSnapshotAssets)
      .where(
        inArray(
          schema.mailSignatureSnapshotAssets.signatureSnapshotId,
          snapshotIds,
        ),
      );
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
      .where(
        inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds),
      );
    await db
      .delete(schema.mailSignatureVersionAssets)
      .where(
        inArray(
          schema.mailSignatureVersionAssets.signatureVersionId,
          (
            await db
              .select({ id: schema.mailSignatureVersions.id })
              .from(schema.mailSignatureVersions)
              .where(
                inArray(
                  schema.mailSignatureVersions.senderIdentityId,
                  identityIds,
                ),
              )
          ).map((row) => row.id),
        ),
      );
    await db
      .delete(schema.mailSignatureVersions)
      .where(
        inArray(schema.mailSignatureVersions.senderIdentityId, identityIds),
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

  await db
    .delete(schema.auditLogs)
    .where(like(schema.auditLogs.entityId, `${FIXTURE}%`));
}

async function setupComposeFixture(db: TestDb) {
  const address = fixtureAddress("compose");
  const mailbox = await createMailbox(db, adminActor, {
    address,
    mailboxType: "personal",
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

async function addRecipient(
  db: TestDb,
  actor: MailActorContext,
  draft: DraftDetailView,
  address: string,
): Promise<DraftDetailView> {
  return addDraftRecipient(db, actor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
    recipientType: "to",
    address,
  });
}

async function createRevision(
  db: TestDb,
  actor: MailActorContext,
  draft: DraftDetailView,
) {
  return createOutboundRevisionFromDraft(db, actor, {
    draftId: draft.id,
    expectedAutosaveVersion: draft.autosaveVersion,
  });
}

describe("draft + outbound revision integration", () => {
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
    await enableMailAccess(db, SEED_IDS.staffA);
    await cleanupFixtures(db);
  });

  after(async () => {
    await cleanupFixtures(db);
    dispose?.();
  });

  it("does not create blank compose draft", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const result = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
    });
    assert.equal(result.created, false);
    await cleanupFixtures(db);
  });

  it("allows incomplete draft but rejects send-ready revision", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      bodyText: "Draft body only",
    });
    assert.equal(created.created, true);

    await assert.rejects(
      () =>
        createOutboundRevisionFromDraft(db, staffActor, {
          draftId: created.item.id,
          expectedAutosaveVersion: created.item.autosaveVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
    await cleanupFixtures(db);
  });

  it("requires both sender grant and mailbox can_send for revision", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);

    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Hello",
      bodyText: "Body",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "client@example.com");

    await assertHasSenderIdentitySendGrant(
      db,
      staffActor,
      identity.id,
    );
    await assertCanComposeFromIdentityInMailbox(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
    });

    await db
      .update(schema.mailMailboxMembers)
      .set({ canSend: 0, updatedAt: new Date().toISOString() })
      .where(eq(schema.mailMailboxMembers.id, `${FIXTURE}-member`));

    await assert.rejects(
      () =>
        createOutboundRevisionFromDraft(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await assert.rejects(
      () => assertCanComposeFromIdentityInMailbox(db, superAdminActor, {
        senderIdentityId: identity.id,
        mailboxId: mailbox.id,
      }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("creates revision with signature snapshot and stable hash", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);

    const sigV1 = await createSignatureVersion(db, adminActor, {
      senderIdentityId: identity.id,
      bodyText: "Signature V1",
    });
    await activateSignatureVersion(db, adminActor, sigV1.id);

    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Project Update",
      bodyText: "Hello team.",
      bodyHtml: "<p>Hello team.</p>",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "alice@example.com");

    const revision = await createRevision(db, staffActor, draft);

    const recomputed = await recomputeOutboundRevisionContentHash(
      db,
      revision.id,
    );
    assert.equal(recomputed.contentHash, revision.contentHash);
    assert.equal(recomputed.hashVersion, 1);

    const [snapshot] = await db
      .select()
      .from(schema.mailSignatureSnapshots)
      .where(eq(schema.mailSignatureSnapshots.id, revision.signatureSnapshotId));
    assert.equal(snapshot?.bodyText, "Signature V1");
    assert.equal(snapshot?.sourceSignatureVersionId, sigV1.id);

    const sigV2 = await createSignatureVersion(db, adminActor, {
      senderIdentityId: identity.id,
      bodyText: "Signature V2",
    });
    await activateSignatureVersion(db, adminActor, sigV2.id);

    const [snapshotAfterV2] = await db
      .select()
      .from(schema.mailSignatureSnapshots)
      .where(eq(schema.mailSignatureSnapshots.id, revision.signatureSnapshotId));
    assert.equal(snapshotAfterV2?.bodyText, "Signature V1");

    await cleanupFixtures(db);
  });

  it("preserves first revision when draft changes and second revision is created", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);

    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "First subject",
      bodyText: "First body",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "first@example.com");

    const r1 = await createRevision(db, staffActor, draft);

    draft = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      subject: "Second subject",
      bodyText: "Second body",
    });

    const r2 = await createRevision(db, staffActor, draft);

    const [storedR1] = await db
      .select()
      .from(schema.mailOutboundRevisions)
      .where(eq(schema.mailOutboundRevisions.id, r1.id));
    assert.equal(storedR1?.subject, "First subject");
    assert.notEqual(r1.contentHash, r2.contentHash);

    await cleanupFixtures(db);
  });

  it("rejects revision without mail access", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Hello",
      bodyText: "Body",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "client@example.com");

    const noAccessActor = { ...staffActor, mailAccessEnabled: false };
    await assert.rejects(
      () =>
        createOutboundRevisionFromDraft(db, noAccessActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
    await cleanupFixtures(db);
  });

  it("rejects revision without sender grant", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Hello",
      bodyText: "Body",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "client@example.com");

    const [grant] = await db
      .select()
      .from(schema.mailSenderIdentityGrants)
      .where(eq(schema.mailSenderIdentityGrants.senderIdentityId, identity.id))
      .limit(1);
    assert.ok(grant);
    await revokeSenderIdentityGrant(db, adminActor, { grantId: grant.id });

    await assert.rejects(
      () =>
        createOutboundRevisionFromDraft(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
    await cleanupFixtures(db);
  });

  it("rejects revision when sender identity is suspended", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Hello",
      bodyText: "Body",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "client@example.com");

    await suspendSenderIdentity(db, adminActor, identity.id);
    await assert.rejects(
      () =>
        createOutboundRevisionFromDraft(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );
    await cleanupFixtures(db);
  });

  it("sanitizes unsafe draft HTML on create and read", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const unsafe =
      '<script>alert(1)</script><div onclick="evil()">Hello</div><a href="javascript:evil()">click</a>';

    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      bodyHtml: unsafe,
      bodyText: "Hello",
    });
    assert.ok(created.created);
    assert.doesNotMatch(created.item.bodyHtml ?? "", /<script/i);
    assert.doesNotMatch(created.item.bodyHtml ?? "", /onclick/i);
    assert.doesNotMatch(created.item.bodyHtml ?? "", /javascript:/i);

    const loaded = await getDraft(db, staffActor, created.item.id);
    assert.doesNotMatch(loaded.bodyHtml ?? "", /<script/i);
    assert.doesNotMatch(loaded.bodyHtml ?? "", /onclick/i);

    await cleanupFixtures(db);
  });

  it("rejects revision when expected autosave version is stale", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Hello",
      bodyText: "Body",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "client@example.com");

    const staleExpected = draft.autosaveVersion;
    draft = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      subject: "Updated",
    });

    const beforeRevisions = (
      await db.select().from(schema.mailOutboundRevisions)
    ).length;

    await assert.rejects(
      () =>
        createOutboundRevisionFromDraft(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: staleExpected,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "STALE_VERSION",
    );

    const afterRevisions = (
      await db.select().from(schema.mailOutboundRevisions)
    ).length;
    assert.equal(afterRevisions, beforeRevisions);

    await cleanupFixtures(db);
  });

  it("bumps autosave_version on recipient add and rejects stale recipient mutation", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Hello",
      bodyText: "Body",
    });
    assert.ok(created.created);
    const draft = created.item;
    assert.equal(draft.autosaveVersion, 0);

    const afterRecipient = await addRecipient(
      db,
      staffActor,
      draft,
      "first@example.com",
    );
    assert.equal(afterRecipient.autosaveVersion, 1);

    await assert.rejects(
      () =>
        addDraftRecipient(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: 0,
          recipientType: "to",
          address: "second@example.com",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "STALE_VERSION",
    );

    const recipients = await db
      .select()
      .from(schema.mailDraftRecipients)
      .where(eq(schema.mailDraftRecipients.draftId, draft.id));
    assert.equal(recipients.length, 1);

    await cleanupFixtures(db);
  });

  it("rolls back revision graph when draft version guard fails at commit", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Guard test",
      bodyText: "Body",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "client@example.com");

    const frozenVersion = draft.autosaveVersion;
    await db
      .update(schema.mailDrafts)
      .set({
        autosaveVersion: frozenVersion + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.mailDrafts.id, draft.id));

    const now = new Date().toISOString();
    const snapshotId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const auditId = crypto.randomUUID();

    const beforeSnapshots = (
      await db.select().from(schema.mailSignatureSnapshots)
    ).length;
    const beforeRevisions = (
      await db.select().from(schema.mailOutboundRevisions)
    ).length;

    await assert.rejects(() =>
      runMailBatch(db, [
        db.insert(schema.mailSignatureSnapshots).values({
          id: snapshotId,
          senderIdentityId: identity.id,
          sourceSignatureVersionId: null,
          bodyText: "",
          bodyHtmlSanitized: null,
          assetRefsJson: null,
          snapshotHash: "a".repeat(64),
          createdAt: now,
        }),
        db.insert(schema.mailOutboundRevisions).values({
          id: revisionId,
          revisionChainId: crypto.randomUUID(),
          revisionNumber: 1,
          parentRevisionId: null,
          sourceDraftId: draft.id,
          revisionKind: "staff_submit",
          createdByUserId: SEED_IDS.staffA,
          createdAt: now,
          mailboxId: mailbox.id,
          senderIdentityId: identity.id,
          fromAddress: identity.address,
          fromDisplayName: null,
          subject: "Guard test",
          bodyText: "Body",
          bodyHtmlSanitized: null,
          sensitivity: "normal",
          composeMode: "new",
          replyToMessageId: null,
          signatureSnapshotId: snapshotId,
          contentHash: "b".repeat(64),
          hashVersion: 1,
        }),
        buildDraftVersionGuardedAuditInsert(
          db,
          staffActor,
          { draftId: draft.id, expectedAutosaveVersion: frozenVersion },
          {
            auditId,
            now,
            action: MAIL_AUDIT_ACTIONS.revisionCreated,
            entityId: revisionId,
            entityType: "mail_outbound_revision",
            metadata: { revisionId, draftId: draft.id },
          },
        ),
      ]),
    );

    const afterSnapshots = (
      await db.select().from(schema.mailSignatureSnapshots)
    ).length;
    const afterRevisions = (
      await db.select().from(schema.mailOutboundRevisions)
    ).length;
    assert.equal(afterSnapshots, beforeSnapshots);
    assert.equal(afterRevisions, beforeRevisions);

    await cleanupFixtures(db);
  });

  it("default mailbox wins when default and sent_folder differ", async () => {
    await cleanupFixtures(db);
    const defaultMailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("compose-default"),
      mailboxType: "personal",
    });
    const sentMailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("compose-sent"),
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address: fixtureAddress("sent-folder-only"),
      defaultMailboxId: defaultMailbox.id,
      sentFolderMailboxId: sentMailbox.id,
    });
    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });

    const now = new Date().toISOString();
    for (const mailboxId of [defaultMailbox.id, sentMailbox.id]) {
      await db.insert(schema.mailMailboxMembers).values({
        id: `${FIXTURE}-member-${mailboxId}`,
        mailboxId,
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
    }

    await assertCanComposeFromIdentityInMailbox(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: defaultMailbox.id,
    });

    await assert.rejects(
      () =>
        assertCanComposeFromIdentityInMailbox(db, staffActor, {
          senderIdentityId: identity.id,
          mailboxId: sentMailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );

    await cleanupFixtures(db);
  });

  it("allows default-null send-only identity to compose via sent-folder fallback", async () => {
    await cleanupFixtures(db);
    const sentMailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("send-only-sent"),
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address: fixtureAddress("send-only"),
      defaultMailboxId: null,
      sentFolderMailboxId: sentMailbox.id,
    });
    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });
    const now = new Date().toISOString();
    await db.insert(schema.mailMailboxMembers).values({
      id: `${FIXTURE}-member-send-only`,
      mailboxId: sentMailbox.id,
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

    await assertCanComposeFromIdentityInMailbox(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: sentMailbox.id,
    });

    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: sentMailbox.id,
      subject: "Send-only compose",
      bodyText: "Body",
    });
    assert.ok(created.created);
    let draft = created.item;
    draft = await addRecipient(db, staffActor, draft, "client@example.com");
    const revision = await createRevision(db, staffActor, draft);
    assert.ok(revision.id);

    await cleanupFixtures(db);
  });

  it("rejects fallback compose without sent-folder can_send membership", async () => {
    await cleanupFixtures(db);
    const sentMailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("fallback-no-member"),
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address: fixtureAddress("fallback-no-member-id"),
      defaultMailboxId: null,
      sentFolderMailboxId: sentMailbox.id,
    });
    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });

    await assert.rejects(
      () =>
        assertCanComposeFromIdentityInMailbox(db, staffActor, {
          senderIdentityId: identity.id,
          mailboxId: sentMailbox.id,
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "FORBIDDEN",
    );

    await cleanupFixtures(db);
  });

  it("allows compose when default and sent_folder reference the same mailbox", async () => {
    await cleanupFixtures(db);
    const mailbox = await createMailbox(db, adminActor, {
      address: fixtureAddress("same-mailbox"),
      mailboxType: "personal",
    });
    const identity = await createSenderIdentity(db, adminActor, {
      address: fixtureAddress("same-mailbox-id"),
      defaultMailboxId: mailbox.id,
      sentFolderMailboxId: mailbox.id,
    });
    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId: identity.id,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
    });
    const now = new Date().toISOString();
    await db.insert(schema.mailMailboxMembers).values({
      id: `${FIXTURE}-member-same`,
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

    await assertCanComposeFromIdentityInMailbox(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
    });

    await cleanupFixtures(db);
  });

  it("rolls back partial revision graph when batch fails late", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db);
    const now = new Date().toISOString();
    const snapshotId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const wrongIdentityId = crypto.randomUUID();

    const beforeSnapshots = (
      await db.select().from(schema.mailSignatureSnapshots)
    ).length;
    const beforeRevisions = (
      await db.select().from(schema.mailOutboundRevisions)
    ).length;

    await assert.rejects(() =>
      runMailBatch(db, [
        db.insert(schema.mailSignatureSnapshots).values({
          id: snapshotId,
          senderIdentityId: identity.id,
          sourceSignatureVersionId: null,
          bodyText: "",
          bodyHtmlSanitized: null,
          assetRefsJson: null,
          snapshotHash: "a".repeat(64),
          createdAt: now,
        }),
        db.insert(schema.mailOutboundRevisions).values({
          id: revisionId,
          revisionChainId: crypto.randomUUID(),
          revisionNumber: 1,
          parentRevisionId: null,
          sourceDraftId: null,
          revisionKind: "staff_submit",
          createdByUserId: SEED_IDS.staffA,
          createdAt: now,
          mailboxId: mailbox.id,
          senderIdentityId: wrongIdentityId,
          fromAddress: identity.address,
          fromDisplayName: null,
          subject: "Atomic fail test",
          bodyText: "Body",
          bodyHtmlSanitized: null,
          sensitivity: "normal",
          composeMode: "new",
          replyToMessageId: null,
          signatureSnapshotId: snapshotId,
          contentHash: "b".repeat(64),
          hashVersion: 1,
        }),
      ]),
    );

    const afterSnapshots = (
      await db.select().from(schema.mailSignatureSnapshots)
    ).length;
    const afterRevisions = (
      await db.select().from(schema.mailOutboundRevisions)
    ).length;
    assert.equal(afterSnapshots, beforeSnapshots);
    assert.equal(afterRevisions, beforeRevisions);

    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, revisionId));
    assert.equal(audits.length, 0);

    await cleanupFixtures(db);
  });
});
