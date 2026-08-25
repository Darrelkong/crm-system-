import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase } from "@/lib/db";
import type { Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import type { MailRouteActorResolver } from "@/lib/mail/api-helpers";
import type { User } from "../../../../drizzle/schema/users";
import { createMailbox } from "@/lib/mail/mailbox-service";
import { createSenderIdentity } from "@/lib/mail/sender-identity-service";
import type { MailAdminPermission } from "../../../../drizzle/schema/mail-admin-grants";

export const FIXTURE = "mail-read-api";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export function actor(
  userId: string,
  options: {
    crmRole?: "admin" | "staff";
    mailAccessEnabled?: boolean;
    adminGrants?: MailAdminPermission[];
  } = {},
): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole:
      options.crmRole ?? (userId === SEED_IDS.admin ? "admin" : "staff"),
    mailAccessEnabled: options.mailAccessEnabled ?? true,
    adminGrants: options.adminGrants ?? [],
    audit: { ipAddress: "127.0.0.1", userAgent: "mail-read-api-test" },
  };
}

export const adminActor = actor(SEED_IDS.admin, {
  adminGrants: ["account_mgmt", "address_assignment"],
});

export function fixtureAddress(localPart: string): string {
  return `${FIXTURE}-${localPart}@echfronthk.com`;
}

export function makeRequireMailActor(
  db: TestDb,
  actorContext: MailActorContext,
): MailRouteActorResolver {
  return async () => ({
    user: { id: actorContext.userId } as User,
    actor: actorContext,
    db: db as unknown as Database,
  });
}

export async function enableMailAccess(db: TestDb, userId: string) {
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

export async function cleanupFixtures(db: TestDb) {
  const mailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.address, `${FIXTURE}%`));
  const mailboxIds = mailboxes.map((row) => row.id);

  if (mailboxIds.length) {
    const messages = await db
      .select({ id: schema.mailMessages.id })
      .from(schema.mailMessages)
      .where(inArray(schema.mailMessages.mailboxId, mailboxIds));
    const messageIds = messages.map((row) => row.id);

    if (messageIds.length) {
      await db
        .delete(schema.mailMessageAttachments)
        .where(inArray(schema.mailMessageAttachments.messageId, messageIds));
      await db
        .delete(schema.mailMessageRecipients)
        .where(inArray(schema.mailMessageRecipients.messageId, messageIds));
      await db
        .delete(schema.mailMessageReadStates)
        .where(inArray(schema.mailMessageReadStates.messageId, messageIds));
      await db
        .delete(schema.mailMessageBodies)
        .where(inArray(schema.mailMessageBodies.messageId, messageIds));
      await db
        .delete(schema.mailMessages)
        .where(inArray(schema.mailMessages.id, messageIds));
    }

    const threads = await db
      .select({ id: schema.mailThreads.id })
      .from(schema.mailThreads)
      .where(inArray(schema.mailThreads.mailboxId, mailboxIds));
    if (threads.length) {
      await db
        .delete(schema.mailThreads)
        .where(inArray(schema.mailThreads.id, threads.map((row) => row.id)));
    }

    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, mailboxIds));

    const identities = await db
      .select({ id: schema.mailSenderIdentities.id })
      .from(schema.mailSenderIdentities)
      .where(inArray(schema.mailSenderIdentities.defaultMailboxId, mailboxIds));
    if (identities.length) {
      await db
        .delete(schema.mailSenderIdentityGrants)
        .where(
          inArray(
            schema.mailSenderIdentityGrants.senderIdentityId,
            identities.map((row) => row.id),
          ),
        );
      await db
        .delete(schema.mailSenderIdentities)
        .where(inArray(schema.mailSenderIdentities.id, identities.map((row) => row.id)));
    }

    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, mailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, mailboxIds));
  }

  await db
    .delete(schema.mailSenderIdentities)
    .where(like(schema.mailSenderIdentities.address, `${FIXTURE}%`));

  await db
    .delete(schema.mailStoredFiles)
    .where(like(schema.mailStoredFiles.id, `${FIXTURE}%`));
}

export async function addMailboxMember(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    userId: string;
    canRead?: boolean;
    canReply?: boolean;
    canSend?: boolean;
  },
) {
  const now = new Date().toISOString();
  await db.insert(schema.mailMailboxMembers).values({
    id: input.id,
    mailboxId: input.mailboxId,
    userId: input.userId,
    canRead: input.canRead === false ? 0 : 1,
    canReply: input.canReply ? 1 : 0,
    canSend: input.canSend ? 1 : 0,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

export async function insertMessage(
  db: TestDb,
  input: {
    id: string;
    mailboxId: string;
    direction: "inbound" | "outbound";
    subject?: string;
    bodyText?: string;
    bodyHtml?: string | null;
    trashedAt?: string | null;
    receivedAt?: string;
    sentAt?: string | null;
    withBcc?: boolean;
    withAttachment?: boolean;
    senderIdentityId?: string;
    threadId?: string;
    createdAt?: string;
    fromAddress?: string;
  },
) {
  const now = new Date().toISOString();
  const threadId = input.threadId ?? `${input.id}-thread`;
  const createdAt = input.createdAt ?? now;

  const [existingThread] = await db
    .select({ id: schema.mailThreads.id })
    .from(schema.mailThreads)
    .where(eq(schema.mailThreads.id, threadId))
    .limit(1);
  if (!existingThread) {
    await db.insert(schema.mailThreads).values({
      id: threadId,
      mailboxId: input.mailboxId,
      subjectNormalized: (input.subject ?? "Test").toLowerCase(),
      lastMessageAt: input.receivedAt ?? input.sentAt ?? createdAt,
      createdAt,
      updatedAt: createdAt,
    });
  }

  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: input.direction,
    fromAddress:
      input.fromAddress ??
      (input.direction === "inbound"
        ? "client@example.com"
        : fixtureAddress("sender")),
    fromDisplayName: "Sender",
    subject: input.subject ?? "Test subject",
    previewText: "Preview snippet",
    receivedAt:
      input.direction === "inbound" ? (input.receivedAt ?? createdAt) : null,
    sentAt:
      input.direction === "outbound"
        ? (input.sentAt ?? createdAt)
        : input.sentAt ?? null,
    trashedAt: input.trashedAt ?? null,
    composeMode: input.direction === "outbound" ? "new" : null,
    senderIdentityId:
      input.direction === "outbound" ? (input.senderIdentityId ?? null) : null,
    createdAt,
    updatedAt: createdAt,
  });

  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: input.bodyText ?? "Secret body text",
    bodyHtmlSanitized: input.bodyHtml ?? "<p>Secret body html</p>",
    createdAt,
    updatedAt: createdAt,
  });

  await db.insert(schema.mailMessageRecipients).values({
    id: `${input.id}-to`,
    messageId: input.id,
    recipientType: "to",
    address: "to@example.com",
    displayName: null,
    sortOrder: 0,
    createdAt,
  });

  if (input.withBcc) {
    await db.insert(schema.mailMessageRecipients).values({
      id: `${input.id}-bcc`,
      messageId: input.id,
      recipientType: "bcc",
      address: "hidden@example.com",
      displayName: null,
      sortOrder: 1,
      createdAt,
    });
  }

  if (input.withAttachment) {
    const storedFileId = `${input.id}-file`;
    await db.insert(schema.mailStoredFiles).values({
      id: storedFileId,
      contentHash: "a".repeat(64),
      originalFilename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      storageProvider: "r2",
      storageBucket: "test",
      storageKey: `mail/inbound-attachments/${storedFileId}`,
      securityScanStatus: "clean",
      securityScannedAt: createdAt,
      createdAt,
    });
    await db.insert(schema.mailMessageAttachments).values({
      id: `${input.id}-attachment`,
      messageId: input.id,
      storedFileId,
      contentHash: "a".repeat(64),
      originalFilename: "doc.pdf",
      displayFilename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      sortOrder: 0,
      deliveryMode: "direct_attachment",
      createdAt,
    });
  }

  return { id: input.id, threadId };
}

export async function setupMailReadApiDb() {
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getPlatformProxy<{ DB: unknown }>({
    configPath: "wrangler.jsonc",
  });
  const db = drizzle(proxy.env.DB, { schema });
  bindTestDatabase(db);

  await enableMailAccess(db, SEED_IDS.admin);
  await enableMailAccess(db, SEED_IDS.staffA);
  await enableMailAccess(db, SEED_IDS.staffB);
  await cleanupFixtures(db);

  const mailbox = await createMailbox(db, adminActor, {
    address: fixtureAddress("shared"),
    mailboxType: "shared",
  });
  const identity = await createSenderIdentity(db, adminActor, {
    address: fixtureAddress("identity"),
    defaultMailboxId: mailbox.id,
  });
  await addMailboxMember(db, {
    id: `${FIXTURE}-reader`,
    mailboxId: mailbox.id,
    userId: SEED_IDS.staffA,
  });

  return {
    db,
    mailboxId: mailbox.id,
    senderIdentityId: identity.id,
    dispose: proxy.dispose,
  };
}

export async function teardownMailReadApiDb(
  db: TestDb,
  dispose?: () => Promise<void>,
) {
  await cleanupFixtures(db);
  bindTestDatabase(null);
  delete process.env.CRM_ALLOW_TEST_DB_BIND;
  await dispose?.();
}
