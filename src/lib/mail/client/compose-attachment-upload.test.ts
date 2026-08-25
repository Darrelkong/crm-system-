import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createQueuedAttachmentEntry,
  isAttachmentPendingUpload,
  mergeUploadedDraftAttachments,
  validateLocalAttachmentFile,
} from "@/lib/mail/client/compose-attachment-upload";

describe("compose-attachment-upload", () => {
  it("tracks pending upload state for queued and uploading attachments", () => {
    assert.equal(
      isAttachmentPendingUpload({ uploadStatus: "queued" }),
      true,
    );
    assert.equal(
      isAttachmentPendingUpload({ uploadStatus: "uploading" }),
      true,
    );
    assert.equal(
      isAttachmentPendingUpload({ uploadStatus: "uploaded" }),
      false,
    );
  });

  it("creates queued entries with file metadata", () => {
    const file = {
      name: "notes.txt",
      size: 128,
      type: "text/plain",
    } as File;
    const entry = createQueuedAttachmentEntry(file, (bytes) => `${bytes} B`);
    assert.equal(entry.uploadStatus, "queued");
    assert.equal(entry.name, "notes.txt");
    assert.equal(entry.sizeLabel, "128 B");
    assert.equal(entry.file, file);
  });

  it("validates local files against existing uploaded totals", () => {
    const file = {
      name: "blocked.exe",
      size: 100,
      type: "application/octet-stream",
    } as File;
    const result = validateLocalAttachmentFile(file, [
      {
        sizeBytes: 0,
        uploadStatus: "uploaded",
      },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorCode, "UNSUPPORTED_FILE_TYPE");
    }
  });

  it("merges uploaded draft attachments while retaining in-flight uploads", () => {
    const merged = mergeUploadedDraftAttachments(
      [
        {
          localId: "local-1",
          serverId: null,
          name: "pending.pdf",
          sizeBytes: 100,
          sizeLabel: "100 B",
          kind: "attachment",
          uploadStatus: "uploading",
          uploadProgress: 40,
          error: null,
          errorCode: null,
          file: null,
        },
      ],
      {
        id: "draft-1",
        authorUserId: "user-1",
        mailboxId: "mailbox-1",
        senderIdentityId: "identity-1",
        subject: "Subject",
        bodyText: "Body",
        bodyHtml: null,
        hasHtml: false,
        sensitivity: "normal",
        composeMode: "new",
        replyToMessageId: null,
        autosaveVersion: 2,
        lastSavedAt: "2026-01-01T00:00:00.000Z",
        discardedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        recipients: [],
        attachments: [
          {
            id: "att-1",
            displayFilename: "saved.pdf",
            sortOrder: 0,
            deliveryMode: "attachment",
            secureExpiryDays: null,
            sizeBytes: 2048,
          },
        ],
      },
      (bytes) => `${bytes ?? 0} B`,
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.serverId, "att-1");
    assert.equal(merged[0]?.uploadStatus, "uploaded");
    assert.equal(merged[1]?.localId, "local-1");
    assert.equal(merged[1]?.uploadStatus, "uploading");
  });
});
