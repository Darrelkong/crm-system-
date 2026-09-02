import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  addDraftRecipient,
  createDraft,
  updateDraft,
  type DraftDetailView,
} from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import {
  activateSignatureVersion,
  createSignatureVersion,
} from "@/lib/mail/signature-service";
import { createOutboundRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import type { MailAdminPermission } from "../../../drizzle/schema/mail-admin-grants";

const FIXTURE = "mail-customer-assoc";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  crmRole: "admin" | "staff" = userId === SEED_IDS.admin ? "admin" : "staff",
  grants: MailAdminPermission[] = [
    "account_mgmt",
    "address_assignment",
    "signature_template",
  ],
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole,
    mailAccessEnabled: true,
    adminGrants: grants,
    audit: { ipAddress: "127.0.0.1", userAgent: "mail-customer-assoc-test" },
  };
}

const adminActor = actor(SEED_IDS.admin);
const staffActor = actor(SEED_IDS.staffA, "staff", []);
const staffBOther = actor(SEED_IDS.staffB, "staff", []);

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
  const snapshotIds = revisionIds.length
    ? (
        await db
          .select({ id: schema.mailOutboundRevisions.signatureSnapshotId })
          .from(schema.mailOutboundRevisions)
          .where(inArray(schema.mailOutboundRevisions.id, revisionIds))
      ).map((row) => row.id)
    : [];

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
}

async function setupComposeFixture(db: TestDb, staffUserId: string) {
  const address = fixtureAddress(`compose-${staffUserId.slice(0, 8)}`);
  const mailbox = await createMailbox(db, adminActor, {
    address,
    mailboxType: "personal",
    ownerUserId: staffUserId,
  });
  const identity = await createSenderIdentity(db, adminActor, {
    address,
    defaultMailboxId: mailbox.id,
  });
  await grantSenderIdentityAccess(db, adminActor, {
    senderIdentityId: identity.id,
    targetUserId: staffUserId,
    canSend: true,
  });

  const now = new Date().toISOString();
  await db
    .update(schema.mailMailboxMembers)
    .set({ canRead: 1, canReply: 1, canSend: 1, updatedAt: now })
    .where(
      and(
        eq(schema.mailMailboxMembers.mailboxId, mailbox.id),
        eq(schema.mailMailboxMembers.userId, staffUserId),
      ),
    );

  return { mailbox, identity };
}

async function createStaffDraft(db: TestDb): Promise<DraftDetailView> {
  const { mailbox, identity } = await setupComposeFixture(db, SEED_IDS.staffA);
  const created = await createDraft(db, staffActor, {
    senderIdentityId: identity.id,
    mailboxId: mailbox.id,
    subject: "Association test",
    bodyText: "Body",
  });
  assert.ok(created.created);
  return created.item;
}

describe("mail draft customer association", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;

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
    await enableMailAccess(db, SEED_IDS.staffB);
    await cleanupFixtures(db);
  });

  after(async () => {
    try {
      await cleanupFixtures(db);
    } finally {
      bindTestDatabase(null);
      delete process.env.CRM_ALLOW_TEST_DB_BIND;
      await dispose?.();
    }
  });

  it("allows staff owner to attach owned customer", async () => {
    await cleanupFixtures(db);
    const draft = await createStaffDraft(db);

    const updated = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      customerAssociation: {
        customerId: SEED_IDS.customerStaffA,
        associationType: "manual",
      },
    });

    assert.ok(updated.customerAssociation);
    assert.equal(updated.customerAssociation.customerId, SEED_IDS.customerStaffA);
    assert.equal(updated.customerAssociation.associationType, "manual");
    assert.equal(updated.customerAssociation.name, "Staff A 测试客户");
    assert.ok(updated.customerAssociation.salesStage);
    await cleanupFixtures(db);
  });

  it("allows admin to attach accessible customer", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db, SEED_IDS.admin);
    const created = await createDraft(db, adminActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Admin association",
      bodyText: "Body",
    });
    assert.ok(created.created);

    const updated = await updateDraft(db, adminActor, {
      draftId: created.item.id,
      expectedAutosaveVersion: created.item.autosaveVersion,
      customerAssociation: {
        customerId: SEED_IDS.customerStaffB,
        associationType: "manual",
      },
    });

    assert.equal(updated.customerAssociation?.customerId, SEED_IDS.customerStaffB);
    await cleanupFixtures(db);
  });

  it("denies staff non-owner from associating another staff customer", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db, SEED_IDS.staffB);
    const created = await createDraft(db, staffBOther, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Staff B draft",
      bodyText: "Body",
    });
    assert.ok(created.created);

    await assert.rejects(
      () =>
        updateDraft(db, staffBOther, {
          draftId: created.item.id,
          expectedAutosaveVersion: created.item.autosaveVersion,
          customerAssociation: {
            customerId: SEED_IDS.customerStaffA,
            associationType: "manual",
          },
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.status === 403 &&
        error.message === "Customer association not permitted",
    );
    await cleanupFixtures(db);
  });

  it("denies association to inaccessible customer on owned draft", async () => {
    await cleanupFixtures(db);
    const draft = await createStaffDraft(db);

    await assert.rejects(
      () =>
        updateDraft(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
          customerAssociation: {
            customerId: SEED_IDS.customerStaffB,
            associationType: "manual",
          },
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.status === 403 &&
        error.message === "Customer association not permitted",
    );
    await cleanupFixtures(db);
  });

  it("denies public pool customer association for staff", async () => {
    await cleanupFixtures(db);
    const draft = await createStaffDraft(db);

    await assert.rejects(
      () =>
        updateDraft(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
          customerAssociation: {
            customerId: SEED_IDS.customerPublicPool,
            associationType: "manual",
          },
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.status === 403 &&
        error.message === "Customer association not permitted",
    );
    await cleanupFixtures(db);
  });

  it("rejects invalid customer id", async () => {
    await cleanupFixtures(db);
    const draft = await createStaffDraft(db);

    await assert.rejects(
      () =>
        updateDraft(db, staffActor, {
          draftId: draft.id,
          expectedAutosaveVersion: draft.autosaveVersion,
          customerAssociation: {
            customerId: "00000000-0000-0000-0000-000000000099",
            associationType: "manual",
          },
        }),
      (error: unknown) =>
        error instanceof MailServiceError &&
        error.status === 404 &&
        error.message === "Customer not found",
    );
    await cleanupFixtures(db);
  });

  it("returns safe association summary without internal customer fields", async () => {
    await cleanupFixtures(db);
    const draft = await createStaffDraft(db);
    const updated = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      customerAssociation: {
        customerId: SEED_IDS.customerStaffA,
        associationType: "auto_match",
      },
    });

    assert.deepEqual(
      Object.keys(updated.customerAssociation ?? {}).sort(),
      [
        "associationType",
        "customerCode",
        "customerId",
        "name",
        "ownerName",
        "salesStage",
      ],
    );
    assert.equal(updated.customerAssociation?.associationType, "auto_match");
    await cleanupFixtures(db);
  });

  it("clears association when customerId is null", async () => {
    await cleanupFixtures(db);
    const draft = await createStaffDraft(db);
    const linked = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      customerAssociation: {
        customerId: SEED_IDS.customerStaffA,
        associationType: "manual",
      },
    });
    assert.ok(linked.customerAssociation);

    const cleared = await updateDraft(db, staffActor, {
      draftId: linked.id,
      expectedAutosaveVersion: linked.autosaveVersion,
      customerAssociation: { clear: true },
    });
    assert.equal(cleared.customerAssociation, undefined);

    const [row] = await db
      .select()
      .from(schema.mailDrafts)
      .where(eq(schema.mailDrafts.id, draft.id))
      .limit(1);
    assert.equal(row?.customerId, null);
    assert.equal(row?.customerAssociationType, null);
    assert.equal(row?.customerAssociatedAt, null);
    await cleanupFixtures(db);
  });

  it("preserves customer association on outbound revision freeze", async () => {
    await cleanupFixtures(db);
    const { mailbox, identity } = await setupComposeFixture(db, SEED_IDS.staffA);
    const sig = await createSignatureVersion(db, adminActor, {
      senderIdentityId: identity.id,
      bodyText: "Signature",
    });
    await activateSignatureVersion(db, adminActor, sig.id);

    const created = await createDraft(db, staffActor, {
      senderIdentityId: identity.id,
      mailboxId: mailbox.id,
      subject: "Revision freeze",
      bodyText: "Body",
    });
    assert.ok(created.created);

    let draft = await updateDraft(db, staffActor, {
      draftId: created.item.id,
      expectedAutosaveVersion: created.item.autosaveVersion,
      customerAssociation: {
        customerId: SEED_IDS.customerStaffA,
        associationType: "manual",
      },
    });
    draft = await addDraftRecipient(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      recipientType: "to",
      address: "client@example.com",
    });

    const [draftRow] = await db
      .select()
      .from(schema.mailDrafts)
      .where(eq(schema.mailDrafts.id, draft.id))
      .limit(1);
    assert.ok(draftRow?.customerId);
    assert.ok(draftRow?.customerAssociatedAt);

    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });

    const [revisionRow] = await db
      .select()
      .from(schema.mailOutboundRevisions)
      .where(eq(schema.mailOutboundRevisions.id, revision.id))
      .limit(1);

    assert.equal(revisionRow?.customerId, draftRow?.customerId);
    assert.equal(
      revisionRow?.customerAssociationType,
      draftRow?.customerAssociationType,
    );
    assert.equal(
      revisionRow?.customerAssociatedByUserId,
      draftRow?.customerAssociatedByUserId,
    );
    assert.equal(revisionRow?.customerAssociatedAt, draftRow?.customerAssociatedAt);
    await cleanupFixtures(db);
  });

  it("still updates draft content without association changes", async () => {
    await cleanupFixtures(db);
    const draft = await createStaffDraft(db);

    const updated = await updateDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
      subject: "Updated subject only",
    });

    assert.equal(updated.subject, "Updated subject only");
    assert.equal(updated.customerAssociation, undefined);
    await cleanupFixtures(db);
  });
});
