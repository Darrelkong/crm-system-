import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import * as schema from "../../../../drizzle/schema";
import {
  actor,
  makeRequireMailActor,
  setupMailReadApiDb,
  teardownMailReadApiDb,
  type TestDb,
} from "@/app/api/mail/mail-read-route-test-helpers";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { createDraft } from "@/lib/mail/draft-service";
import { grantSenderIdentityAccess } from "@/lib/mail/sender-identity-grant-service";
import {
  authorizeLargeAttachmentUpload,
  assertAuthorizeResponseHasNoSecrets,
} from "@/lib/mail/large-attachment/large-attachment-upload-authorization-service";
import { finalizeLargeAttachmentUpload } from "@/lib/mail/large-attachment/large-attachment-upload-finalize-service";
import {
  LARGE_ATTACHMENT_MAX_FILE_BYTES,
  TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT,
} from "@/lib/mail/large-attachment/large-attachment-policy";
import {
  LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS,
  LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS,
  addMillisecondsToIsoTimestamp,
} from "@/lib/mail/large-attachment/large-attachment-constants";
import { MailServiceError } from "@/lib/mail/errors";

const TRUST_NOW = new Date("2026-08-30T10:00:00.000Z");
const TRUST_NOW_ISO = TRUST_NOW.toISOString();
const DECLARED_SHA256 = "c".repeat(64);
const CONTENT_MD5 = "1B2M2Y8AsgTpgAmY7PhCfg==";
const FILE_BYTES = 4 * 1024 * 1024;

describe("large attachment upload service integration", () => {
  let db: TestDb;
  let dispose: (() => Promise<void>) | undefined;
  let mailboxId: string;
  let senderIdentityId: string;
  const staffActor = actor(SEED_IDS.staffA);
  const staffBActor = actor(SEED_IDS.staffB);
  const adminActor = actor(SEED_IDS.admin, {
    adminGrants: ["account_mgmt", "address_assignment"],
  });

  before(async () => {
    const setup = await setupMailReadApiDb();
    db = setup.db;
    dispose = setup.dispose;
    mailboxId = setup.mailboxId;
    senderIdentityId = setup.senderIdentityId;
    const now = new Date().toISOString();
    await db
      .update(schema.mailMailboxMembers)
      .set({ canSend: 1, canReply: 1, updatedAt: now })
      .where(
        and(
          eq(schema.mailMailboxMembers.mailboxId, mailboxId),
          eq(schema.mailMailboxMembers.userId, SEED_IDS.staffA),
        ),
      );
    await grantSenderIdentityAccess(db, adminActor, {
      senderIdentityId,
      targetUserId: SEED_IDS.staffA,
      canSend: true,
      canReply: true,
    });
  });

  after(async () => {
    await teardownMailReadApiDb(db, dispose);
  });

  async function createDraftItem() {
    const created = await createDraft(db, staffActor, {
      mailboxId,
      senderIdentityId,
      subject: "Large attachment test",
      bodyText: "Body",
      allowEmptyShell: true,
    });
    if (!created.created || !created.item) {
      throw new Error("Draft creation failed");
    }
    return created.item;
  }

  function mockPresign() {
    return async () => ({
      uploadUrl:
        "https://111111111111.r2.cloudflarestorage.com/crm-mail-large-attachments/mail/large-attachments/2026/08/30/test?X-Amz-Signature=fakesig",
      requiredHeaders: {
        "Content-Type": "application/zip",
        "Content-MD5": CONTENT_MD5,
        "If-None-Match": "*" as const,
      },
    });
  }

  it("authorizes valid owner with server-derived session and rejects policy violations", async () => {
    const draft = await createDraftItem();

    await assert.rejects(
      () =>
        authorizeLargeAttachmentUpload(db, staffBActor, {
          draftId: draft.id,
          authorize: {
            filename: "archive.zip",
            mimeType: "application/zip",
            sizeBytes: FILE_BYTES,
            declaredSha256: DECLARED_SHA256,
            contentMd5: CONTENT_MD5,
          },
          ports: { presignPut: mockPresign(), trustNow: () => TRUST_NOW },
        }),
      (error: unknown) => error instanceof MailServiceError && error.status === 404,
    );

    const authorization = await authorizeLargeAttachmentUpload(db, staffActor, {
      draftId: draft.id,
      authorize: {
        filename: "archive.zip",
        mimeType: "application/zip",
        sizeBytes: FILE_BYTES,
        declaredSha256: DECLARED_SHA256,
        contentMd5: CONTENT_MD5,
      },
      ports: { presignPut: mockPresign(), trustNow: () => TRUST_NOW },
    });
    assertAuthorizeResponseHasNoSecrets(authorization);

    const sessions = await db
      .select()
      .from(schema.mailLargeAttachmentUploadSessions)
      .where(eq(schema.mailLargeAttachmentUploadSessions.draftId, draft.id));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.actorUserId, staffActor.userId);
    assert.equal(sessions[0]?.mailboxId, mailboxId);
    assert.equal(
      sessions[0]?.expiresAt,
      addMillisecondsToIsoTimestamp(TRUST_NOW_ISO, LARGE_ATTACHMENT_UPLOAD_AUTH_TTL_MS),
    );

    await assert.rejects(
      () =>
        authorizeLargeAttachmentUpload(db, staffActor, {
          draftId: draft.id,
          authorize: {
            filename: "malware.exe",
            mimeType: "application/zip",
            sizeBytes: FILE_BYTES,
            declaredSha256: DECLARED_SHA256,
            contentMd5: CONTENT_MD5,
          },
          ports: { presignPut: mockPresign(), trustNow: () => TRUST_NOW },
        }),
      (error: unknown) => error instanceof MailServiceError && error.status === 400,
    );

    await assert.rejects(
      () =>
        authorizeLargeAttachmentUpload(db, staffActor, {
          draftId: draft.id,
          authorize: {
            filename: "archive.zip",
            mimeType: "application/zip",
            sizeBytes: LARGE_ATTACHMENT_MAX_FILE_BYTES + 1,
            declaredSha256: DECLARED_SHA256,
            contentMd5: CONTENT_MD5,
          },
          ports: { presignPut: mockPresign(), trustNow: () => TRUST_NOW },
        }),
      (error: unknown) => error instanceof MailServiceError && error.status === 400,
    );

    const countDraft = await createDraftItem();
    const now = TRUST_NOW_ISO;
    for (let index = 0; index < TOTAL_COMPOSE_ATTACHMENT_MAX_COUNT; index += 1) {
      const storedFileId = `large-fill-${index}-${countDraft.id.slice(0, 8)}`;
      await db.insert(schema.mailStoredFiles).values({
        id: storedFileId,
        contentHash: `${index}`.padStart(64, "d"),
        originalFilename: `large-${index}.zip`,
        mimeType: "application/zip",
        sizeBytes: 1024,
        storageProvider: "r2",
        storageBucket: "crm-mail-large-attachments",
        storageKey: `mail/large-attachments/fill/${storedFileId}`,
        securityScanStatus: "unscanned",
        createdAt: now,
      });
      await db.insert(schema.mailDraftAttachments).values({
        id: `large-row-${index}-${countDraft.id.slice(0, 8)}`,
        draftId: countDraft.id,
        storedFileId,
        displayFilename: `large-${index}.zip`,
        sortOrder: index,
        deliveryMode: "large_attachment",
        createdAt: now,
        updatedAt: now,
      });
    }
    await assert.rejects(
      () =>
        authorizeLargeAttachmentUpload(db, staffActor, {
          draftId: countDraft.id,
          authorize: {
            filename: "archive.zip",
            mimeType: "application/zip",
            sizeBytes: FILE_BYTES,
            declaredSha256: DECLARED_SHA256,
            contentMd5: CONTENT_MD5,
          },
          ports: { presignPut: mockPresign(), trustNow: () => TRUST_NOW },
        }),
      (error: unknown) => error instanceof MailServiceError && error.status === 400,
    );
  });

  it("finalizes with mocked HEAD adapter and supports idempotent replay", async () => {
    const draft = await createDraftItem();
    const authorization = await authorizeLargeAttachmentUpload(db, staffActor, {
      draftId: draft.id,
      authorize: {
        filename: "archive.zip",
        mimeType: "application/zip",
        sizeBytes: FILE_BYTES,
        declaredSha256: DECLARED_SHA256,
        contentMd5: CONTENT_MD5,
      },
      ports: { presignPut: mockPresign(), trustNow: () => TRUST_NOW },
    });

    const mockHead = async () => ({
      storageKey: authorization.storageKey,
      etag: "abc123etag",
      sizeBytes: FILE_BYTES,
      contentType: "application/zip",
      storageVersion: "ver-1",
      versionProof: "deferred_s3_head" as const,
    });

    await assert.rejects(
      () =>
        finalizeLargeAttachmentUpload(db, staffBActor, {
          draftId: draft.id,
          sessionId: authorization.uploadSessionId,
          expectedAutosaveVersion: draft.autosaveVersion,
          ports: { headObject: mockHead, trustNow: () => TRUST_NOW },
        }),
      (error: unknown) => error instanceof MailServiceError && error.status === 403,
    );

    const item = await finalizeLargeAttachmentUpload(db, staffActor, {
      draftId: draft.id,
      sessionId: authorization.uploadSessionId,
      expectedAutosaveVersion: draft.autosaveVersion,
      ports: { headObject: mockHead, trustNow: () => TRUST_NOW },
    });
    assert.equal(item.attachments.length, 1);
    assert.equal(item.attachments[0]?.deliveryMode, "large_attachment");

    const [lifecycle] = await db
      .select()
      .from(schema.mailLargeAttachmentLifecycle)
      .where(eq(schema.mailLargeAttachmentLifecycle.storageEtag, "abc123etag"))
      .limit(1);
    assert.ok(lifecycle);
    assert.equal(lifecycle.status, "temporary");
    assert.equal(lifecycle.storageVersion, "ver-1");
    assert.equal(
      lifecycle.temporaryExpiresAt,
      addMillisecondsToIsoTimestamp(TRUST_NOW_ISO, LARGE_ATTACHMENT_TEMPORARY_RETENTION_MS),
    );

    const replay = await finalizeLargeAttachmentUpload(db, staffActor, {
      draftId: draft.id,
      sessionId: authorization.uploadSessionId,
      expectedAutosaveVersion: item.autosaveVersion,
      ports: { headObject: mockHead, trustNow: () => TRUST_NOW },
    });
    assert.equal(replay.attachments.length, 1);

    await assert.rejects(
      () =>
        finalizeLargeAttachmentUpload(db, staffActor, {
          draftId: draft.id,
          sessionId: authorization.uploadSessionId,
          expectedAutosaveVersion: item.autosaveVersion,
          ports: {
            headObject: async () => ({
              storageKey: authorization.storageKey,
              etag: "abc123etag",
              sizeBytes: FILE_BYTES + 1,
              contentType: "application/zip",
              storageVersion: null,
              versionProof: "deferred_s3_head" as const,
            }),
            trustNow: () => TRUST_NOW,
          },
        }),
      (error: unknown) => error instanceof MailServiceError && error.status === 400,
    );
  });
});
