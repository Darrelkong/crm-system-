import { eq, inArray, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy } from "wrangler";
import * as schema from "../../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { bindTestDatabase, releaseTestDatabase, type Database } from "@/lib/db";
import { assertFixtureAddressesDoNotCollideWithCrmContacts } from "@/lib/mail/local-verification-fixture/collision";
import type { MailActorContext } from "@/lib/mail/actor-context";
import {
  FIXTURE_ATTACHMENT_BYTES,
  hashFixtureBytes,
} from "@/lib/mail/local-attachment-verification-fixture/bytes";
import {
  LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES,
  LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX,
  LOCAL_MAIL_ATTACHMENT_VERIFY_HEADER_INJECTION_FILENAME,
  LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS,
  LOCAL_MAIL_ATTACHMENT_VERIFY_R2_KEY_PREFIX,
  LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS,
  attachmentFixtureSubject,
  attachmentFixtureTimestamp,
} from "@/lib/mail/local-attachment-verification-fixture/constants";
import {
  assertLocalMailAttachmentVerifyFixtureAllowed,
  type LocalMailAttachmentVerifyCliTarget,
} from "@/lib/mail/local-attachment-verification-fixture/guard";
import type { InboundRawPayloadBucket } from "@/lib/mail/inbound-raw-payload-store";
import { MAIL_ATTACHMENTS_R2_BUCKET_NAME } from "@/lib/mail/attachments-env";
import { resolveDownloadableMailAttachment } from "@/lib/mail/mail-attachment-download-service";
import { handleGetMailAttachmentDownload } from "@/app/api/mail/attachments/[attachmentId]/download/route";
import { R2MailAttachmentByteReader } from "@/lib/mail/mail-attachment-byte-reader";
import { makeRequireMailActor } from "@/app/api/mail/mail-read-route-test-helpers";
import type { TestDb } from "@/app/api/mail/mail-read-route-test-helpers";

type AttachmentFixtureBucket = InboundRawPayloadBucket & {
  delete(key: string): Promise<void>;
};

const fixtureR2Keys = new Set<string>();

function fixtureLikePattern(): string {
  return `${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}%`;
}

function mailActor(userId: string): MailActorContext {
  return {
    userId,
    sessionId: null,
    crmRole: userId === SEED_IDS.admin ? "admin" : "staff",
    mailAccessEnabled: true,
    adminGrants: [],
    audit: {
      ipAddress: "127.0.0.1",
      userAgent: "local-mail-attachment-verify-2h5b",
    },
  };
}

function storageKeyFor(storedFileId: string): string {
  return `${LOCAL_MAIL_ATTACHMENT_VERIFY_R2_KEY_PREFIX}${storedFileId}`;
}

export async function connectLocalAttachmentVerificationFixtureEnv(
  target: LocalMailAttachmentVerifyCliTarget,
): Promise<{
  db: Database;
  attachmentsBucket: AttachmentFixtureBucket;
  dispose: () => Promise<void>;
}> {
  assertLocalMailAttachmentVerifyFixtureAllowed(target);
  process.env.CRM_ALLOW_TEST_DB_BIND = "1";
  const proxy = await getPlatformProxy<{
    DB: unknown;
    ATTACHMENTS: AttachmentFixtureBucket;
  }>({
    configPath: "wrangler.jsonc",
  });
  const db = drizzle(proxy.env.DB, { schema }) as unknown as Database;
  bindTestDatabase(db);
  return {
    db,
    attachmentsBucket: proxy.env.ATTACHMENTS,
    dispose: async () => {
      releaseTestDatabase(db);
      await proxy.dispose();
    },
  };
}

async function putFixtureR2Object(
  bucket: AttachmentFixtureBucket,
  storageKey: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<void> {
  await bucket.put(storageKey, bytes, {
    httpMetadata: { contentType: mimeType },
  });
  fixtureR2Keys.add(storageKey);
}

async function deleteFixtureR2Objects(bucket: AttachmentFixtureBucket): Promise<number> {
  let removed = 0;
  for (const key of fixtureR2Keys) {
    if (!key.startsWith(LOCAL_MAIL_ATTACHMENT_VERIFY_R2_KEY_PREFIX)) {
      continue;
    }
    await bucket.delete(key);
    removed += 1;
  }
  fixtureR2Keys.clear();
  return removed;
}

async function enableMailAccess(db: Database, userId: string, now: string) {
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

async function insertMailboxMember(
  db: Database,
  input: { id: string; mailboxId: string; userId: string },
  now: string,
) {
  await db.insert(schema.mailMailboxMembers).values({
    id: input.id,
    mailboxId: input.mailboxId,
    userId: input.userId,
    canRead: 1,
    canReply: 0,
    canSend: 0,
    canAssign: 0,
    canManageProcessing: 0,
    canAddInternalNote: 0,
    grantedBy: SEED_IDS.admin,
    createdAt: now,
    updatedAt: now,
  });
}

async function insertInboundMessage(
  db: Database,
  input: {
    id: string;
    mailboxId: string;
    subject: string;
    trashedAt?: string | null;
  },
  now: string,
) {
  const threadId = `${input.id}-THREAD`;
  await db.insert(schema.mailThreads).values({
    id: threadId,
    mailboxId: input.mailboxId,
    subjectNormalized: input.subject.toLowerCase(),
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessages).values({
    id: input.id,
    threadId,
    mailboxId: input.mailboxId,
    direction: "inbound",
    fromAddress: LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.inboundSender,
    fromDisplayName: "Fixture Sender",
    subject: input.subject,
    previewText: "Attachment verify fixture",
    receivedAt: now,
    sentAt: null,
    trashedAt: input.trashedAt ?? null,
    composeMode: null,
    senderIdentityId: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageBodies).values({
    messageId: input.id,
    bodyText: "Local attachment verification fixture body.",
    bodyHtmlSanitized: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.mailMessageRecipients).values({
    id: `${input.id}-TO`,
    messageId: input.id,
    recipientType: "to",
    address: LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.toRecipient,
    displayName: null,
    sortOrder: 0,
    createdAt: now,
  });
}

async function insertStoredFile(
  db: Database,
  input: {
    id: string;
    bytes: Uint8Array;
    originalFilename: string;
    mimeType: string;
    securityScanStatus: "clean" | "unscanned" | "blocked" | "scan_failed";
    putInR2: boolean;
  },
  bucket: AttachmentFixtureBucket,
  now: string,
) {
  const contentHash = hashFixtureBytes(input.bytes);
  const storageKey = storageKeyFor(input.id);
  if (input.putInR2) {
    await putFixtureR2Object(bucket, storageKey, input.bytes, input.mimeType);
  }
  await db.insert(schema.mailStoredFiles).values({
    id: input.id,
    contentHash,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
    storageProvider: "r2",
    storageBucket: MAIL_ATTACHMENTS_R2_BUCKET_NAME,
    storageKey,
    securityScanStatus: input.securityScanStatus,
    securityScannedAt: input.securityScanStatus === "unscanned" ? null : now,
    createdAt: now,
  });
  return { contentHash, storageKey, sizeBytes: input.bytes.byteLength };
}

async function insertMessageAttachment(
  db: Database,
  input: {
    id: string;
    messageId: string;
    storedFileId: string;
    contentHash: string;
    originalFilename: string;
    displayFilename: string;
    mimeType: string;
    sizeBytes: number;
    deliveryMode: "direct_attachment" | "secure_file";
  },
  now: string,
) {
  await db.insert(schema.mailMessageAttachments).values({
    id: input.id,
    messageId: input.messageId,
    storedFileId: input.storedFileId,
    contentHash: input.contentHash,
    originalFilename: input.originalFilename,
    displayFilename: input.displayFilename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sortOrder: 0,
    deliveryMode: input.deliveryMode,
    secureExpiryDays: input.deliveryMode === "secure_file" ? 7 : null,
    createdAt: now,
  });
}

export type LocalAttachmentVerifySetupResult = {
  messageCount: number;
  attachmentCount: number;
  storedFileCount: number;
  r2ObjectCount: number;
};

export async function cleanupLocalAttachmentVerificationFixtures(
  db: Database,
  bucket?: AttachmentFixtureBucket,
): Promise<{
  deletedMessages: number;
  deletedStoredFiles: number;
  deletedR2Objects: number;
}> {
  const pattern = fixtureLikePattern();

  const fixtureMailboxes = await db
    .select({ id: schema.mailMailboxes.id })
    .from(schema.mailMailboxes)
    .where(like(schema.mailMailboxes.id, pattern));
  const fixtureMailboxIds = [
    ...new Set([
      ...Object.values(LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS),
      ...fixtureMailboxes.map((row) => row.id),
    ]),
  ];

  const fixtureMessagesById = await db
    .select({ id: schema.mailMessages.id })
    .from(schema.mailMessages)
    .where(like(schema.mailMessages.id, pattern));
  const fixtureMessagesByMailbox =
    fixtureMailboxIds.length > 0
      ? await db
          .select({ id: schema.mailMessages.id })
          .from(schema.mailMessages)
          .where(inArray(schema.mailMessages.mailboxId, fixtureMailboxIds))
      : [];
  const messageIds = [
    ...new Set([
      ...fixtureMessagesById.map((row) => row.id),
      ...fixtureMessagesByMailbox.map((row) => row.id),
    ]),
  ];

  await db
    .delete(schema.auditLogs)
    .where(
      or(
        like(schema.auditLogs.entityId, pattern),
        like(schema.auditLogs.metadata, `%${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}%`),
      ),
    );

  if (messageIds.length > 0) {
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

  const threadIds = [
    ...new Set([
      ...Object.values(LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS).map(
        (id) => `${id}-THREAD`,
      ),
      ...(fixtureMailboxIds.length > 0
        ? (
            await db
              .select({ id: schema.mailThreads.id })
              .from(schema.mailThreads)
              .where(inArray(schema.mailThreads.mailboxId, fixtureMailboxIds))
          ).map((row) => row.id)
        : []),
    ]),
  ];
  if (threadIds.length > 0) {
    await db
      .delete(schema.mailThreads)
      .where(inArray(schema.mailThreads.id, threadIds));
  }

  const storedFiles = await db
    .select({
      id: schema.mailStoredFiles.id,
      storageKey: schema.mailStoredFiles.storageKey,
    })
    .from(schema.mailStoredFiles)
    .where(like(schema.mailStoredFiles.id, pattern));
  const r2KeysFromDb = storedFiles
    .map((row) => row.storageKey)
    .filter((key) => key.startsWith(LOCAL_MAIL_ATTACHMENT_VERIFY_R2_KEY_PREFIX));
  if (storedFiles.length > 0) {
    await db
      .delete(schema.mailStoredFiles)
      .where(inArray(schema.mailStoredFiles.id, storedFiles.map((row) => row.id)));
  }

  if (fixtureMailboxIds.length > 0) {
    await db
      .delete(schema.mailMailboxMembers)
      .where(inArray(schema.mailMailboxMembers.mailboxId, fixtureMailboxIds));
    await db
      .delete(schema.mailReceivingAddresses)
      .where(inArray(schema.mailReceivingAddresses.mailboxId, fixtureMailboxIds));
    await db
      .delete(schema.mailMailboxes)
      .where(inArray(schema.mailMailboxes.id, fixtureMailboxIds));
  }

  await db
    .delete(schema.mailMailboxMembers)
    .where(like(schema.mailMailboxMembers.id, pattern));

  let deletedR2Objects = 0;
  if (bucket) {
    for (const key of r2KeysFromDb) {
      fixtureR2Keys.add(key);
    }
    deletedR2Objects = await deleteFixtureR2Objects(bucket);
  }

  return {
    deletedMessages: messageIds.length,
    deletedStoredFiles: storedFiles.length,
    deletedR2Objects,
  };
}

export async function setupLocalAttachmentVerificationFixtures(
  db: Database,
  bucket: AttachmentFixtureBucket,
): Promise<LocalAttachmentVerifySetupResult> {
  await cleanupLocalAttachmentVerificationFixtures(db, bucket);

  await assertFixtureAddressesDoNotCollideWithCrmContacts(db, [
    LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.inboundSender,
    LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.toRecipient,
    LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.staffPersonalMailbox,
    LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.staffBPrivateMailbox,
    LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.sharedMailbox,
  ]);

  const now = attachmentFixtureTimestamp(0);
  for (const userId of Object.values(LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS)) {
    await enableMailAccess(db, userId, now);
  }

  await db.insert(schema.mailMailboxes).values([
    {
      id: LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS.staffPersonal,
      address: LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.staffPersonalMailbox,
      displayName: "Attachment Verify Staff A Personal",
      mailboxType: "personal",
      status: "active",
      createdBy: LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffA,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS.staffBPrivate,
      address: LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.staffBPrivateMailbox,
      displayName: "Attachment Verify Staff B Private",
      mailboxType: "personal",
      status: "active",
      createdBy: LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffB,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS.shared,
      address: LOCAL_MAIL_ATTACHMENT_VERIFY_ADDRESSES.sharedMailbox,
      displayName: "Attachment Verify Shared",
      mailboxType: "shared",
      status: "active",
      createdBy: LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.admin,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}-MEM-SHARED-A`,
      mailboxId: LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS.shared,
      userId: LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffA,
    },
    now,
  );
  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}-MEM-SHARED-B`,
      mailboxId: LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS.shared,
      userId: LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffB,
    },
    now,
  );

  const sharedMailboxId = LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS.shared;

  await insertMailboxMember(
    db,
    {
      id: `${LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_PREFIX}-MEM-STAFF-A-PERSONAL`,
      mailboxId: LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS.staffPersonal,
      userId: LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffA,
    },
    now,
  );

  async function seedAttachmentFixture(input: {
    messageId: string;
    attachmentId: string;
    storedFileId: string;
    subjectLabel: string;
    bytes: Uint8Array;
    mimeType: string;
    filename: string;
    displayFilename?: string;
    scanStatus?: "clean" | "unscanned" | "blocked" | "scan_failed";
    deliveryMode?: "direct_attachment" | "secure_file";
    putInR2?: boolean;
    mailboxId?: string;
    trashedAt?: string | null;
  }) {
    await insertInboundMessage(
      db,
      {
        id: input.messageId,
        mailboxId: input.mailboxId ?? sharedMailboxId,
        subject: attachmentFixtureSubject(input.subjectLabel),
        trashedAt: input.trashedAt,
      },
      now,
    );
    const stored = await insertStoredFile(
      db,
      {
        id: input.storedFileId,
        bytes: input.bytes,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        securityScanStatus: input.scanStatus ?? "clean",
        putInR2: input.putInR2 ?? true,
      },
      bucket,
      now,
    );
    await insertMessageAttachment(
      db,
      {
        id: input.attachmentId,
        messageId: input.messageId,
        storedFileId: input.storedFileId,
        contentHash: stored.contentHash,
        originalFilename: input.filename,
        displayFilename: input.displayFilename ?? input.filename,
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        deliveryMode: input.deliveryMode ?? "direct_attachment",
      },
      now,
    );
  }

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.cleanPdf,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanPdf,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.cleanPdf,
    subjectLabel: "Clean PDF",
    bytes: FIXTURE_ATTACHMENT_BYTES.cleanPdf,
    mimeType: "application/pdf",
    filename: "fixture-clean.pdf",
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.cleanPng,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanPng,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.cleanPng,
    subjectLabel: "Clean PNG",
    bytes: FIXTURE_ATTACHMENT_BYTES.cleanPng,
    mimeType: "image/png",
    filename: "fixture-clean.png",
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.cleanBinary,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanBinary,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.cleanBinary,
    subjectLabel: "Clean Binary",
    bytes: FIXTURE_ATTACHMENT_BYTES.cleanBinary,
    mimeType: "application/octet-stream",
    filename: "fixture-clean.bin",
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.unscanned,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.unscanned,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.unscanned,
    subjectLabel: "Unscanned",
    bytes: FIXTURE_ATTACHMENT_BYTES.unscanned,
    mimeType: "application/octet-stream",
    filename: "fixture-unscanned.bin",
    scanStatus: "unscanned",
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.blocked,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.blocked,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.blocked,
    subjectLabel: "Blocked",
    bytes: FIXTURE_ATTACHMENT_BYTES.blocked,
    mimeType: "application/octet-stream",
    filename: "fixture-blocked.bin",
    scanStatus: "blocked",
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.scanFailed,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.scanFailed,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.scanFailed,
    subjectLabel: "Scan Failed",
    bytes: FIXTURE_ATTACHMENT_BYTES.scanFailed,
    mimeType: "application/octet-stream",
    filename: "fixture-scan-failed.bin",
    scanStatus: "scan_failed",
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.secureFile,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.secureFile,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.secureFile,
    subjectLabel: "Secure File Mode",
    bytes: FIXTURE_ATTACHMENT_BYTES.secureFile,
    mimeType: "application/octet-stream",
    filename: "fixture-secure.bin",
    deliveryMode: "secure_file",
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.missingR2,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.missingR2,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.missingR2,
    subjectLabel: "Missing R2",
    bytes: FIXTURE_ATTACHMENT_BYTES.cleanBinary,
    mimeType: "application/octet-stream",
    filename: "fixture-missing-r2.bin",
    putInR2: false,
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.sharedClean,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.sharedClean,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.sharedClean,
    subjectLabel: "Shared Mailbox Clean",
    bytes: FIXTURE_ATTACHMENT_BYTES.sharedClean,
    mimeType: "application/octet-stream",
    filename: "fixture-shared-clean.bin",
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.unauthorizedMailbox,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.unauthorizedMailbox,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.unauthorizedMailbox,
    subjectLabel: "Unauthorized Mailbox",
    bytes: FIXTURE_ATTACHMENT_BYTES.unauthorizedMailbox,
    mimeType: "application/octet-stream",
    filename: "fixture-unauthorized.bin",
    mailboxId: LOCAL_MAIL_ATTACHMENT_VERIFY_MAILBOX_IDS.staffPersonal,
  });

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.headerInjection,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.headerInjection,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.headerInjection,
    subjectLabel: "Header Injection Filename",
    bytes: FIXTURE_ATTACHMENT_BYTES.headerInjection,
    mimeType: "application/pdf",
    filename: LOCAL_MAIL_ATTACHMENT_VERIFY_HEADER_INJECTION_FILENAME,
    displayFilename: LOCAL_MAIL_ATTACHMENT_VERIFY_HEADER_INJECTION_FILENAME,
  });

  const sharedReuseStored = await insertStoredFile(
    db,
    {
      id: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.sharedFile,
      bytes: FIXTURE_ATTACHMENT_BYTES.sharedFileReuse,
      originalFilename: "shared-reuse.bin",
      mimeType: "application/octet-stream",
      securityScanStatus: "clean",
      putInR2: true,
    },
    bucket,
    now,
  );

  for (const [messageId, attachmentId] of [
    [
      LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.sharedFileMessageA,
      LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.sharedFileA,
    ],
    [
      LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.sharedFileMessageB,
      LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.sharedFileB,
    ],
  ] as const) {
    await insertInboundMessage(
      db,
      {
        id: messageId,
        mailboxId: sharedMailboxId,
        subject: attachmentFixtureSubject("Shared Stored File Reuse"),
      },
      now,
    );
    await insertMessageAttachment(
      db,
      {
        id: attachmentId,
        messageId,
        storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.sharedFile,
        contentHash: sharedReuseStored.contentHash,
        originalFilename: "shared-reuse.bin",
        displayFilename: "shared-reuse.bin",
        mimeType: "application/octet-stream",
        sizeBytes: sharedReuseStored.sizeBytes,
        deliveryMode: "direct_attachment",
      },
      now,
    );
  }

  await seedAttachmentFixture({
    messageId: LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS.trashedClean,
    attachmentId: LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.trashedClean,
    storedFileId: LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS.trashedClean,
    subjectLabel: "Trashed Clean",
    bytes: FIXTURE_ATTACHMENT_BYTES.trashedClean,
    mimeType: "application/octet-stream",
    filename: "fixture-trashed.bin",
    trashedAt: attachmentFixtureTimestamp(1),
  });

  const attachments = await db
    .select({ id: schema.mailMessageAttachments.id })
    .from(schema.mailMessageAttachments)
    .where(like(schema.mailMessageAttachments.id, fixtureLikePattern()));

  return {
    messageCount: Object.keys(LOCAL_MAIL_ATTACHMENT_VERIFY_MESSAGE_IDS).length,
    attachmentCount: attachments.length,
    storedFileCount: Object.keys(LOCAL_MAIL_ATTACHMENT_VERIFY_STORED_FILE_IDS).length,
    r2ObjectCount: fixtureR2Keys.size,
  };
}

export async function verifyLocalAttachmentVerificationFixtures(
  db: Database,
  bucket: AttachmentFixtureBucket,
): Promise<Record<string, unknown>> {
  const attachments = await db
    .select()
    .from(schema.mailMessageAttachments)
    .where(like(schema.mailMessageAttachments.id, fixtureLikePattern()));

  const checks: Record<string, unknown> = {
    attachmentCount: attachments.length,
    r2KeysTracked: fixtureR2Keys.size,
  };

  for (const attachment of attachments) {
    const [storedFile] = await db
      .select()
      .from(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, attachment.storedFileId))
      .limit(1);
    const row: Record<string, unknown> = {
      messageId: attachment.messageId,
      deliveryMode: attachment.deliveryMode,
      scanStatus: storedFile?.securityScanStatus ?? null,
      sizeBytes: attachment.sizeBytes,
      contentHashMatches:
        storedFile?.contentHash === attachment.contentHash &&
        storedFile?.id === attachment.storedFileId,
    };

    if (
      attachment.id !== LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.missingR2 &&
      storedFile?.storageKey.startsWith(LOCAL_MAIL_ATTACHMENT_VERIFY_R2_KEY_PREFIX)
    ) {
      const object = await bucket.get(storedFile.storageKey);
      row.r2Present = object !== null;
      row.r2ByteLength = object
        ? (await object.arrayBuffer()).byteLength
        : null;
    }
    checks[attachment.id] = row;
  }

  for (const actorId of [
    LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffA,
    LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffB,
  ]) {
    await resolveDownloadableMailAttachment(
      db,
      mailActor(actorId),
      LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.sharedClean,
      { folder: "inbox" },
    );
  }

  return checks;
}

export async function verifyLocalAttachmentDownloadApi(
  db: Database,
  bucket: AttachmentFixtureBucket,
): Promise<Record<string, unknown>> {
  const byteReader = () => new R2MailAttachmentByteReader(bucket);
  const staffA = mailActor(LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffA);
  const staffB = mailActor(LOCAL_MAIL_ATTACHMENT_VERIFY_FIXTURE_ACTORS.staffB);

  const authorized = await handleGetMailAttachmentDownload(
    new Request(
      `http://localhost/api/mail/attachments/${LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanPdf}/download?folder=inbox`,
    ),
    LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.cleanPdf,
    {
      requireMailActor: makeRequireMailActor(db as TestDb, staffA),
      createByteReader: byteReader,
    },
  );

  const unauthorized = await handleGetMailAttachmentDownload(
    new Request(
      `http://localhost/api/mail/attachments/${LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.unauthorizedMailbox}/download?folder=inbox`,
    ),
    LOCAL_MAIL_ATTACHMENT_VERIFY_ATTACHMENT_IDS.unauthorizedMailbox,
    {
      requireMailActor: makeRequireMailActor(db as TestDb, staffB),
      createByteReader: byteReader,
    },
  );

  const authorizedBytes =
    authorized.status === 200
      ? new Uint8Array(await authorized.arrayBuffer())
      : null;

  return {
    authorizedStatus: authorized.status,
    authorizedBytesLength: authorizedBytes?.byteLength ?? null,
    authorizedBytesMatchPdf:
      authorizedBytes !== null &&
      Buffer.from(authorizedBytes).equals(Buffer.from(FIXTURE_ATTACHMENT_BYTES.cleanPdf)),
    unauthorizedStatus: unauthorized.status,
    contentDisposition: authorized.headers.get("Content-Disposition"),
    contentType: authorized.headers.get("Content-Type"),
    cacheControl: authorized.headers.get("Cache-Control"),
    nosniff: authorized.headers.get("X-Content-Type-Options"),
  };
}
