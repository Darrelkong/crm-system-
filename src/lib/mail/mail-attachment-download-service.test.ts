import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../../../drizzle/schema";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import {
  actor,
  addMailboxMember,
  fixtureAddress,
  insertMessage,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { computeInboundPayloadContentHash } from "@/lib/mail/inbound-payload-hash";
import {
  assertStoredFileRelationshipIntegrity,
  resolveDownloadableMailAttachment,
} from "@/lib/mail/mail-attachment-download-service";
import { MailServiceError } from "@/lib/mail/errors";

const FIXTURE = "mail-attachment-download";

function bytes(label: string): Uint8Array {
  return new TextEncoder().encode(`${FIXTURE}:${label}`);
}

async function insertAttachment(
  db: TestDb,
  input: {
    attachmentId: string;
    messageId: string;
    fileBytes?: Uint8Array;
    scanStatus?: "clean" | "unscanned" | "blocked" | "scan_failed";
    deliveryMode?: "direct_attachment" | "secure_file";
    contentHashOverride?: string;
    omitStoredFile?: boolean;
    filename?: string;
    mimeType?: string;
  },
) {
  const fileBytes = input.fileBytes ?? bytes(input.attachmentId);
  const contentHash =
    input.contentHashOverride ?? computeInboundPayloadContentHash(fileBytes);
  const storedFileId = `${input.attachmentId}-file`;
  const storageKey = `mail/test/${storedFileId}`;

  if (!input.omitStoredFile) {
    await db.insert(schema.mailStoredFiles).values({
      id: storedFileId,
      contentHash,
      originalFilename: input.filename ?? "doc.pdf",
      mimeType: input.mimeType ?? "application/pdf",
      sizeBytes: fileBytes.byteLength,
      storageProvider: "r2",
      storageBucket: "crm-attachments",
      storageKey,
      securityScanStatus: input.scanStatus ?? "clean",
      securityScannedAt:
        (input.scanStatus ?? "clean") === "unscanned"
          ? null
          : new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  }

  await db.insert(schema.mailMessageAttachments).values({
    id: input.attachmentId,
    messageId: input.messageId,
    storedFileId,
    contentHash,
    originalFilename: input.filename ?? "doc.pdf",
    displayFilename: input.filename ?? "doc.pdf",
    mimeType: input.mimeType ?? "application/pdf",
    sizeBytes: fileBytes.byteLength,
    sortOrder: 0,
    deliveryMode: input.deliveryMode ?? "direct_attachment",
    secureExpiryDays: input.deliveryMode === "secure_file" ? 7 : null,
    createdAt: new Date().toISOString(),
  });

  return { fileBytes, storageKey, contentHash, storedFileId };
}

describe("resolveDownloadableMailAttachment", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let mailboxId: string;

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
    mailboxId = setup.mailboxId;
  });

  after(async () => {
    await teardownMailReadApiDb(db, dispose);
  });

  it("allows clean direct_attachment when parent message is readable", async () => {
    const messageId = `${fixtureAddress("dl-ok")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    const { storageKey } = await insertAttachment(db, { attachmentId, messageId });

    const resolved = await resolveDownloadableMailAttachment(
      db,
      actor(SEED_IDS.staffA),
      attachmentId,
      { folder: "inbox" },
    );
    assert.equal(resolved.attachmentId, attachmentId);
    assert.equal(resolved.storageKey, storageKey);
  });

  it("returns NOT_FOUND for unknown attachment", async () => {
    await assert.rejects(
      () =>
        resolveDownloadableMailAttachment(
          db,
          actor(SEED_IDS.staffA),
          `${fixtureAddress("missing")}-att`,
          { folder: "inbox" },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("returns NOT_FOUND for unauthorized parent message", async () => {
    const messageId = `${fixtureAddress("dl-private")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    await insertAttachment(db, { attachmentId, messageId });

    await assert.rejects(
      () =>
        resolveDownloadableMailAttachment(
          db,
          actor(SEED_IDS.staffB),
          attachmentId,
          { folder: "inbox" },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("returns NOT_FOUND when stored file row is missing", () => {
    assert.throws(
      () =>
        assertStoredFileRelationshipIntegrity(
          { storedFileId: "file-a", contentHash: "a".repeat(64) },
          undefined,
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("returns NOT_FOUND for stored-file hash mismatch", () => {
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

  for (const scanStatus of ["unscanned", "blocked", "scan_failed"] as const) {
    it(`denies ${scanStatus} scan status`, async () => {
      const messageId = `${fixtureAddress(`dl-${scanStatus}`)}-msg`;
      const attachmentId = `${messageId}-att`;
      await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
      await insertAttachment(db, { attachmentId, messageId, scanStatus });

      await assert.rejects(
        () =>
          resolveDownloadableMailAttachment(
            db,
            actor(SEED_IDS.staffA),
            attachmentId,
            { folder: "inbox" },
          ),
        (error: unknown) =>
          error instanceof MailServiceError && error.status === 404,
      );
    });
  }

  it("denies secure_file delivery mode", async () => {
    const messageId = `${fixtureAddress("dl-secure")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    await insertAttachment(db, {
      attachmentId,
      messageId,
      deliveryMode: "secure_file",
    });

    await assert.rejects(
      () =>
        resolveDownloadableMailAttachment(
          db,
          actor(SEED_IDS.staffA),
          attachmentId,
          { folder: "inbox" },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("allows shared mailbox Staff B when message is readable", async () => {
    await addMailboxMember(db, {
      id: `${fixtureAddress("dl-shared-b-member")}`,
      mailboxId,
      userId: SEED_IDS.staffB,
    });

    const messageId = `${fixtureAddress("dl-shared-b")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, { id: messageId, mailboxId, direction: "inbound" });
    await insertAttachment(db, { attachmentId, messageId });

    const resolved = await resolveDownloadableMailAttachment(
      db,
      actor(SEED_IDS.staffB),
      attachmentId,
      { folder: "inbox" },
    );
    assert.equal(resolved.messageId, messageId);
  });

  it("evaluates shared stored file per parent message permission", async () => {
    const sharedBytes = bytes("shared-file");
    const sharedHash = computeInboundPayloadContentHash(sharedBytes);
    const sharedStoredFileId = `${fixtureAddress("shared-file")}-stored`;
    const storageKey = `mail/test/${sharedStoredFileId}`;
    await db.insert(schema.mailStoredFiles).values({
      id: sharedStoredFileId,
      contentHash: sharedHash,
      originalFilename: "shared.bin",
      mimeType: "application/octet-stream",
      sizeBytes: sharedBytes.byteLength,
      storageProvider: "r2",
      storageBucket: "crm-attachments",
      storageKey,
      securityScanStatus: "clean",
      securityScannedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const readableMessageId = `${fixtureAddress("shared-readable")}-msg`;
    const readableAttachmentId = `${readableMessageId}-att`;
    await insertMessage(db, {
      id: readableMessageId,
      mailboxId,
      direction: "inbound",
    });
    await db.insert(schema.mailMessageAttachments).values({
      id: readableAttachmentId,
      messageId: readableMessageId,
      storedFileId: sharedStoredFileId,
      contentHash: sharedHash,
      originalFilename: "shared.bin",
      displayFilename: "shared.bin",
      mimeType: "application/octet-stream",
      sizeBytes: sharedBytes.byteLength,
      sortOrder: 0,
      deliveryMode: "direct_attachment",
      createdAt: new Date().toISOString(),
    });

    const privateMailboxId = `${fixtureAddress("private-mailbox")}-id`;
    const now = new Date().toISOString();
    await db.insert(schema.mailMailboxes).values({
      id: privateMailboxId,
      address: fixtureAddress("private-mailbox"),
      displayName: "Private",
      mailboxType: "personal",
      status: "active",
      createdBy: SEED_IDS.staffB,
      createdAt: now,
      updatedAt: now,
    });
    await addMailboxMember(db, {
      id: `${fixtureAddress("private-mailbox")}-member`,
      mailboxId: privateMailboxId,
      userId: SEED_IDS.staffB,
    });

    const privateMessageId = `${fixtureAddress("shared-private")}-msg`;
    const privateAttachmentId = `${privateMessageId}-att`;
    await insertMessage(db, {
      id: privateMessageId,
      mailboxId: privateMailboxId,
      direction: "inbound",
    });
    await db.insert(schema.mailMessageAttachments).values({
      id: privateAttachmentId,
      messageId: privateMessageId,
      storedFileId: sharedStoredFileId,
      contentHash: sharedHash,
      originalFilename: "shared.bin",
      displayFilename: "shared.bin",
      mimeType: "application/octet-stream",
      sizeBytes: sharedBytes.byteLength,
      sortOrder: 0,
      deliveryMode: "direct_attachment",
      createdAt: new Date().toISOString(),
    });

    await resolveDownloadableMailAttachment(
      db,
      actor(SEED_IDS.staffA),
      readableAttachmentId,
      { folder: "inbox" },
    );

    await assert.rejects(
      () =>
        resolveDownloadableMailAttachment(
          db,
          actor(SEED_IDS.staffA),
          privateAttachmentId,
          { folder: "inbox" },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });

  it("allows trashed message with folder=trash", async () => {
    const messageId = `${fixtureAddress("dl-trash-ok")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });
    await insertAttachment(db, { attachmentId, messageId });

    const resolved = await resolveDownloadableMailAttachment(
      db,
      actor(SEED_IDS.staffA),
      attachmentId,
      { folder: "trash" },
    );
    assert.equal(resolved.messageId, messageId);
  });

  it("returns NOT_FOUND for trashed message with folder=inbox", async () => {
    const messageId = `${fixtureAddress("dl-trash-deny")}-msg`;
    const attachmentId = `${messageId}-att`;
    await insertMessage(db, {
      id: messageId,
      mailboxId,
      direction: "inbound",
      trashedAt: new Date().toISOString(),
    });
    await insertAttachment(db, { attachmentId, messageId });

    await assert.rejects(
      () =>
        resolveDownloadableMailAttachment(
          db,
          actor(SEED_IDS.staffA),
          attachmentId,
          { folder: "inbox" },
        ),
      (error: unknown) =>
        error instanceof MailServiceError && error.status === 404,
    );
  });
});
