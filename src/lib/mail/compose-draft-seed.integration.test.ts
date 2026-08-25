import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import { bindTestDatabase, schema } from "@/lib/db";
import { mailReceivingAddresses } from "../../../drizzle/schema/mail-receiving-addresses";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { createSeededComposeDraft } from "@/lib/mail/compose-draft-seed-service";
import { parseComposeDraftSeedRequest } from "@/lib/mail/compose-draft-seed-parsing";
import { createDraft } from "@/lib/mail/draft-service";
import { MailServiceError } from "@/lib/mail/errors";
import { handlePostComposeDraftSeed } from "@/app/api/mail/messages/[id]/compose-draft/route";
import {
  makeRequireMailActor,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { createOutboundRevisionFromDraft } from "@/lib/mail/outbound-revision-service";
import { submitRevisionForApproval } from "@/lib/mail/outbound-approval-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";

const FIXTURE = "mail-phase2h6b";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

function actor(
  userId: string,
  options: {
    grants?: MailActorContext["adminGrants"];
    mailAccessEnabled?: boolean;
  } = {},
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: options.mailAccessEnabled ?? true,
    adminGrants: options.grants ?? [],
    audit: { ipAddress: "127.0.0.1", userAgent: "phase2h6b-test" },
  };
}

const adminActor = actor(SEED_IDS.admin, {
  grants: ["account_mgmt", "address_assignment", "signature_template"],
});
const staffActor = actor(SEED_IDS.staffA);
const staffBActor = actor(SEED_IDS.staffB);

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

async function deleteRevisionGraph(db: TestDb, revisionIds: string[]) {
  if (revisionIds.length === 0) {
    return;
  }

  const approvals = await db
    .select({ id: schema.mailOutboundApprovals.id })
    .from(schema.mailOutboundApprovals)
    .where(inArray(schema.mailOutboundApprovals.currentRevisionId, revisionIds));
  const approvalIds = approvals.map((row) => row.id);
  if (approvalIds.length) {
    await db
      .delete(schema.mailOutboundApprovalEvents)
      .where(inArray(schema.mailOutboundApprovalEvents.approvalId, approvalIds));
    await db
      .delete(schema.mailOutboundApprovals)
      .where(inArray(schema.mailOutboundApprovals.id, approvalIds));
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

async function deleteDraftGraph(db: TestDb, draftIds: string[]) {
  if (draftIds.length === 0) {
    return;
  }

  const revisions = await db
    .select({ id: schema.mailOutboundRevisions.id })
    .from(schema.mailOutboundRevisions)
    .where(inArray(schema.mailOutboundRevisions.sourceDraftId, draftIds));
  await deleteRevisionGraph(
    db,
    revisions.map((row) => row.id),
  );
  await db
    .delete(schema.mailDraftAttachments)
    .where(inArray(schema.mailDraftAttachments.draftId, draftIds));
  await db
    .delete(schema.mailDraftRecipients)
    .where(inArray(schema.mailDraftRecipients.draftId, draftIds));
  await db.delete(schema.mailDrafts).where(inArray(schema.mailDrafts.id, draftIds));
}

async function cleanupFixtures(db: TestDb) {
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);

  const messages = mailboxIds.length
    ? await db
        .select({ id: schema.mailMessages.id })
        .from(schema.mailMessages)
        .where(inArray(schema.mailMessages.mailboxId, mailboxIds))
    : [];
  const messageIds = messages.map((row) => row.id);

  const identities = await db
    .select({ id: schema.mailSenderIdentities.id })
    .from(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));
  const mailboxIdentities = mailboxIds.length
    ? await db
        .select({ id: schema.mailSenderIdentities.id })
        .from(schema.mailSenderIdentities)
        .where(inArray(schema.mailSenderIdentities.defaultMailboxId, mailboxIds))
    : [];
  const identityIds = [
    ...new Set([
      ...identities.map((row) => row.id),
      ...mailboxIdentities.map((row) => row.id),
    ]),
  ];

  const draftIdSets = await Promise.all([
    mailboxIds.length
      ? db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.mailboxId, mailboxIds))
      : Promise.resolve([]),
    identityIds.length
      ? db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.senderIdentityId, identityIds))
      : Promise.resolve([]),
    messageIds.length
      ? db
          .select({ id: schema.mailDrafts.id })
          .from(schema.mailDrafts)
          .where(inArray(schema.mailDrafts.replyToMessageId, messageIds))
      : Promise.resolve([]),
  ]);
  const draftIds = [
    ...new Set(draftIdSets.flatMap((rows) => rows.map((row) => row.id))),
  ];
  await deleteDraftGraph(db, draftIds);

  if (identityIds.length) {
    const revisionsByIdentity = await db
      .select({ id: schema.mailOutboundRevisions.id })
      .from(schema.mailOutboundRevisions)
      .where(inArray(schema.mailOutboundRevisions.senderIdentityId, identityIds));
    await deleteRevisionGraph(
      db,
      revisionsByIdentity.map((row) => row.id),
    );
  }
  if (messageIds.length) {
    await db
      .delete(schema.mailMessageRecipients)
      .where(inArray(schema.mailMessageRecipients.messageId, messageIds));
    await db
      .delete(schema.mailMessageBodies)
      .where(inArray(schema.mailMessageBodies.messageId, messageIds));
    await db
      .delete(schema.mailMessages)
      .where(inArray(schema.mailMessages.id, messageIds));
  }

  if (mailboxIds.length) {
    await db
      .delete(schema.mailThreads)
      .where(inArray(schema.mailThreads.mailboxId, mailboxIds));
  }

  if (identityIds.length) {
    const snapshots = await db
      .select({ id: schema.mailSignatureSnapshots.id })
      .from(schema.mailSignatureSnapshots)
      .where(inArray(schema.mailSignatureSnapshots.senderIdentityId, identityIds));
    const snapshotIds = snapshots.map((row) => row.id);
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

    await db
      .delete(schema.mailSenderIdentityGrants)
      .where(inArray(schema.mailSenderIdentityGrants.senderIdentityId, identityIds));
    await db
      .delete(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.id, identityIds));
  }

  if (mailboxIds.length) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));
    await db
      .delete(mailReceivingAddresses)
      .where(inArray(mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }

  await db
    .delete(mailReceivingAddresses)
    .where(like(mailReceivingAddresses.address, `${FIXTURE}%`));
}

async function setupStaffMailbox(db: TestDb) {
  const address = fixtureAddress("staff");
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

async function insertMessage(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    direction: "inbound" | "outbound";
    subject?: string;
    fromAddress?: string;
    bodyText?: string;
    bodyHtml?: string | null;
    trashedAt?: string | null;
    senderIdentityId?: string | null;
    withBcc?: boolean;
    withCc?: boolean;
  },
) {
  const now = new Date().toISOString();
  const threadId = `${input.id}-thread`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: (input.subject ?? "Hello").toLowerCase(),
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: input.direction,
    fromAddress:
      input.fromAddress ??
      (input.direction === "inbound"
        ? "client@example.com"
        : fixtureAddress("staff")),
    fromDisplayName: "Sender",
    subject: input.subject ?? "Hello",
    subjectNormalized: (input.subject ?? "Hello").toLowerCase(),
    previewText: "Preview",
    receivedAt: input.direction === "inbound" ? now : null,
    sentAt: input.direction === "outbound" ? now : null,
    trashedAt: input.trashedAt ?? null,
    composeMode: input.direction === "outbound" ? "new" : null,
    senderIdentityId: input.senderIdentityId ?? null,
    createdBy: input.direction === "outbound" ? SEED_IDS.staffA : null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: input.bodyText ?? "Original body",
    bodyHtmlSanitized: input.bodyHtml ?? "<p>Original body</p>",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageRecipients).values({
    id: `${input.id}-to`,
    messageId: input.id,
    recipientType: "to",
    address: fixtureAddress("staff"),
    displayName: null,
    sortOrder: 0,
    createdAt: now,
  });
  if (input.withCc) {
    await db.insert(schema.mailMessageRecipients).values({
      id: `${input.id}-cc`,
      messageId: input.id,
      recipientType: "cc",
      address: "cc@example.com",
      displayName: null,
      sortOrder: 1,
      createdAt: now,
    });
  }
  if (input.withBcc) {
    await db.insert(schema.mailMessageRecipients).values({
      id: `${input.id}-bcc`,
      messageId: input.id,
      recipientType: "bcc",
      address: "hidden@example.com",
      displayName: null,
      sortOrder: 2,
      createdAt: now,
    });
  }
}

describe("compose draft seed integration", () => {
  let db: TestDb;
  let dispose: () => Promise<void>;
  let mailboxId: string;
  let identityId: string;

  before(async () => {
    const proxy = await getPlatformProxy<{ DB: unknown }>({
      configPath: "wrangler.jsonc",
    });
    db = drizzle(proxy.env.DB, { schema });
    bindTestDatabase(db);
    dispose = proxy.dispose;
    await cleanupFixtures(db);
    await enableMailAccess(db, SEED_IDS.staffA);
    await enableMailAccess(db, SEED_IDS.staffB);
    const setup = await setupStaffMailbox(db);
    mailboxId = setup.mailbox.id;
    identityId = setup.identity.id;
  });

  after(async () => {
    await cleanupFixtures(db);
    bindTestDatabase(null);
    await dispose();
  });

  it("seeds inbound reply draft with from recipient and Re subject", async () => {
    const messageId = `${FIXTURE}-inbound-reply`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      subject: "Hello",
      fromAddress: "client@example.com",
    });

    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: messageId,
      mode: "reply",
      folder: "inbox",
    });

    assert.equal(draft.composeMode, "reply");
    assert.equal(draft.replyToMessageId, messageId);
    assert.equal(draft.subject, "Re: Hello");
    assert.equal(draft.recipients[0]?.address, "client@example.com");
    assert.match(draft.bodyText, /Sender <client@example.com> wrote:/);
    assert.equal(draft.senderIdentityId, identityId);
    assert.equal(draft.attachments.length, 0);
  });

  it("seeds reply all with empty Bcc even when source has visible Bcc", async () => {
    const messageId = `${FIXTURE}-reply-all-bcc`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withBcc: true,
      withCc: true,
    });

    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: messageId,
      mode: "reply_all",
      folder: "inbox",
    });

    assert.equal(
      draft.recipients.some((recipient) => recipient.recipientType === "bcc"),
      false,
    );
    assert.ok(draft.recipients.some((recipient) => recipient.recipientType === "cc"));
  });

  it("seeds outbound sent reply excluding self from recipients", async () => {
    const messageId = `${FIXTURE}-sent-reply`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "outbound",
      senderIdentityId: identityId,
      fromAddress: fixtureAddress("staff"),
    });
    await db.insert(schema.mailMessageRecipients).values({
      id: `${messageId}-client-to`,
      messageId,
      recipientType: "to",
      address: "client@example.com",
      displayName: null,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
    });

    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: messageId,
      mode: "reply",
      folder: "sent",
    });

    assert.deepEqual(
      draft.recipients.map((recipient) => recipient.address),
      ["client@example.com"],
    );
  });

  it("seeds forward with empty recipients and Fwd subject", async () => {
    const messageId = `${FIXTURE}-forward`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      withCc: true,
      withBcc: true,
    });

    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: messageId,
      mode: "forward",
      folder: "inbox",
    });

    assert.equal(draft.composeMode, "forward");
    assert.equal(draft.replyToMessageId, messageId);
    assert.equal(draft.subject, "Fwd: Hello");
    assert.equal(draft.recipients.length, 0);
    assert.match(draft.bodyText, /Forwarded message/);
    assert.doesNotMatch(draft.bodyText, /hidden@example.com/);
    assert.equal(draft.customerAssociation, undefined);
  });

  it("allows trash seed with folder=trash and rejects wrong folder", async () => {
    const messageId = `${FIXTURE}-trash`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });

    const allowed = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: messageId,
      mode: "reply",
      folder: "trash",
    });
    assert.equal(allowed.composeMode, "reply");

    await assert.rejects(
      () =>
        createSeededComposeDraft(db, staffActor, {
          sourceMessageId: messageId,
          mode: "reply",
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("returns 404 for inaccessible trash source even with folder=trash", async () => {
    const messageId = `${FIXTURE}-trash-private`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () =>
        createSeededComposeDraft(db, staffBActor, {
          sourceMessageId: messageId,
          mode: "reply",
          folder: "trash",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("returns 404 for nonexistent source with folder=trash", async () => {
    await assert.rejects(
      () =>
        createSeededComposeDraft(db, staffActor, {
          sourceMessageId: `${FIXTURE}-missing-message`,
          mode: "reply",
          folder: "trash",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("returns 404 for inaccessible source message", async () => {
    const messageId = `${FIXTURE}-private`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
    });

    await assert.rejects(
      () =>
        createSeededComposeDraft(db, staffBActor, {
          sourceMessageId: messageId,
          mode: "reply",
          folder: "inbox",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("freezes seeded reply provenance through revision creation", async () => {
    const messageId = `${FIXTURE}-revision`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
    });
    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: messageId,
      mode: "reply",
      folder: "inbox",
    });

    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });

    assert.equal(revision.composeMode, "reply");
    const [revisionRow] = await db
      .select({ replyToMessageId: schema.mailOutboundRevisions.replyToMessageId })
      .from(schema.mailOutboundRevisions)
      .where(eq(schema.mailOutboundRevisions.id, revision.id))
      .limit(1);
    assert.equal(revisionRow?.replyToMessageId, messageId);
  });

  it("accepts seeded reply into approval submission", async () => {
    const messageId = `${FIXTURE}-approval`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
    });
    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: messageId,
      mode: "reply",
      folder: "inbox",
    });
    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    const approval = await submitRevisionForApproval(db, staffActor, {
      revisionId: revision.id,
    });
    assert.equal(approval.status, "pending");
  });

  it("blank compose create remains new-only", async () => {
    await assert.rejects(
      () =>
        createDraft(db, staffActor, {
          senderIdentityId: identityId,
          mailboxId,
          composeMode: "reply",
          subject: "Re: Hello",
          bodyText: "Body",
        }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("preserves non-new compose mode on revision pending materialization gate", async () => {
    const messageId = `${FIXTURE}-materialization-boundary`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
    });
    const draft = await createSeededComposeDraft(db, staffActor, {
      sourceMessageId: messageId,
      mode: "reply",
      folder: "inbox",
    });
    const revision = await createOutboundRevisionFromDraft(db, staffActor, {
      draftId: draft.id,
      expectedAutosaveVersion: draft.autosaveVersion,
    });
    assert.equal(revision.composeMode, "reply");
    assert.notEqual(revision.composeMode, "new");
  });

  it("returns 403 when mail access is disabled", async () => {
    const messageId = `${FIXTURE}-mail-access-disabled`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
    });
    const response = await handlePostComposeDraftSeed(
      new Request("http://localhost/api/mail/messages/" + messageId + "/compose-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "reply", folder: "inbox" }),
      }),
      messageId,
      {
        requireMailActor: makeRequireMailActor(
          db,
          actor(SEED_IDS.staffA, { mailAccessEnabled: false }),
        ),
      },
    );
    assert.equal(response.status, 403);
  });

  it("returns 400 for malformed message id", async () => {
    const response = await handlePostComposeDraftSeed(
      new Request("http://localhost/api/mail/messages/%20/compose-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "reply" }),
      }),
      " ",
      {
        requireMailActor: makeRequireMailActor(db, staffActor),
      },
    );
    assert.equal(response.status, 400);
  });
});

describe("compose draft seed API parsing", () => {
  it("rejects unknown request fields", () => {
    assert.throws(
      () =>
        parseComposeDraftSeedRequest({
          mode: "reply",
          subject: "Re: Hello",
        }),
      /Unknown fields/,
    );
  });

  it("rejects injected source-derived fields", () => {
    assert.throws(
      () =>
        parseComposeDraftSeedRequest({
          mode: "reply",
          recipients: [{ recipientType: "to", address: "evil@example.com" }],
        }),
      /Unknown fields/,
    );
  });

  it("rejects mode=new", () => {
    assert.throws(
      () => parseComposeDraftSeedRequest({ mode: "new" }),
      /mode must be one of/,
    );
  });
});
