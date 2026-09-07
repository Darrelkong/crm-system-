import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema";
import {
  insertMessage,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { issueLargeAttachmentDownloadToken } from "./large-attachment-download-token-service";

describe("large attachment download token issuance integration", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let lifecycleId: string;
  let storedFileId: string;

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;

    const now = "2026-09-06T08:00:00.000Z";
    const messageId = "mail-token-issuance-message";
    lifecycleId = "mail-token-issuance-lifecycle";
    storedFileId = "mail-token-issuance-file";
    const contentHash = "d".repeat(64);

    await db
      .delete(schema.mailLargeAttachmentLifecycle)
      .where(eq(schema.mailLargeAttachmentLifecycle.id, lifecycleId));
    await db
      .delete(schema.mailMessageAttachments)
      .where(eq(schema.mailMessageAttachments.messageId, messageId));
    await db
      .delete(schema.mailMessageRecipients)
      .where(eq(schema.mailMessageRecipients.messageId, messageId));
    await db
      .delete(schema.mailMessageReadStates)
      .where(eq(schema.mailMessageReadStates.messageId, messageId));
    await db
      .delete(schema.mailMessageBodies)
      .where(eq(schema.mailMessageBodies.messageId, messageId));
    await db
      .delete(schema.mailMessages)
      .where(eq(schema.mailMessages.id, messageId));
    await db
      .delete(schema.mailThreads)
      .where(eq(schema.mailThreads.id, `${messageId}-thread`));
    await db
      .delete(schema.mailStoredFiles)
      .where(eq(schema.mailStoredFiles.id, storedFileId));

    await insertMessage(db, {
      id: messageId,
      mailboxId: setup.mailboxId,
      senderIdentityId: setup.senderIdentityId,
      direction: "outbound",
      sentAt: now,
      createdAt: now,
    });
    await db.insert(schema.mailStoredFiles).values({
      id: storedFileId,
      contentHash,
      originalFilename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      storageProvider: "r2",
      storageBucket: "crm-mail-large-attachments",
      storageKey:
        "mail/large-attachments/2026/09/00000000-0000-4000-8000-000000000002",
      createdByUserId: SEED_IDS.staffA,
      securityScanStatus: "unscanned",
      createdAt: now,
    });
    await db.insert(schema.mailMessageAttachments).values({
      id: "mail-token-issuance-attachment",
      messageId,
      storedFileId,
      contentHash,
      originalFilename: "report.pdf",
      displayFilename: "customer-report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      sortOrder: 0,
      deliveryMode: "large_attachment",
      createdAt: now,
    });
    await db.insert(schema.mailLargeAttachmentLifecycle).values({
      id: lifecycleId,
      storedFileId,
      status: "temporary",
      uploadedAt: now,
      temporaryExpiresAt: "2026-09-07T08:00:00.000Z",
      declaredContentHash: contentHash,
      storageVersion: "version-1",
      storageEtag: "etag-1",
      finalizedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  after(async () => {
    await db
      .delete(schema.mailLargeAttachmentLifecycle)
      .where(eq(schema.mailLargeAttachmentLifecycle.id, lifecycleId));
    await teardownMailReadApiDb(db, dispose);
  });

  it("rejects standalone token issuance outside durable outbound dispatch", async () => {
    await assert.rejects(
      issueLargeAttachmentDownloadToken(db, {
        lifecycleId,
        storedFileId,
        recipientExpiresAt: "2026-09-13T08:00:00.000Z",
        sentAt: "2026-09-06T08:00:00.000Z",
        authorizationPath: "admin_direct",
        trustNowIso: "2026-09-06T08:00:00.000Z",
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "NOT_DOWNLOADABLE",
    );
    const [lifecycle] = await db
      .select()
      .from(schema.mailLargeAttachmentLifecycle)
      .where(eq(schema.mailLargeAttachmentLifecycle.id, lifecycleId));
    assert.equal(lifecycle?.status, "temporary");
    assert.equal(lifecycle?.downloadTokenHash, null);
  });
});
