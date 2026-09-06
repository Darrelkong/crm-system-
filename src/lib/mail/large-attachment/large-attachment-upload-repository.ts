import { and, eq, isNull } from "drizzle-orm";
import type { MailLargeAttachmentUploadSession } from "../../../../drizzle/schema/mail-large-attachment-upload-sessions";
import { schema, type Database } from "@/lib/db";
import { runMailBatch } from "@/lib/mail/guarded-batch";
import {
  assertUploadSessionHasNoPresignedUrlPersisted,
  type LargeAttachmentUploadSession,
} from "@/lib/mail/large-attachment/large-attachment-upload-session";

export function mapUploadSessionRow(
  row: MailLargeAttachmentUploadSession,
): LargeAttachmentUploadSession {
  assertUploadSessionHasNoPresignedUrlPersisted(row as unknown as Record<string, unknown>);
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    draftId: row.draftId,
    mailboxId: row.mailboxId,
    storedFileId: row.storedFileId,
    storageKey: row.storageKey,
    expectedFilename: row.expectedFilename,
    expectedMimeType: row.expectedMimeType,
    expectedSizeBytes: row.expectedSizeBytes,
    maxSizeBytes: row.maxSizeBytes,
    declaredContentHash: row.declaredContentHash,
    expiresAt: row.expiresAt,
    finalizedAt: row.finalizedAt,
    invalidatedAt: row.invalidatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findUploadSessionById(
  db: Database,
  sessionId: string,
): Promise<LargeAttachmentUploadSession | null> {
  const [row] = await db
    .select()
    .from(schema.mailLargeAttachmentUploadSessions)
    .where(eq(schema.mailLargeAttachmentUploadSessions.id, sessionId))
    .limit(1);
  return row ? mapUploadSessionRow(row) : null;
}

export async function insertUploadSession(
  db: Database,
  input: {
    id: string;
    actorUserId: string;
    draftId: string;
    mailboxId: string;
    storageKey: string;
    expectedFilename: string;
    expectedMimeType: string;
    expectedSizeBytes: number;
    maxSizeBytes: number;
    declaredContentHash: string;
    expiresAt: string;
    createdAt: string;
    acknowledgement: {
      id: string;
      userId: string;
      noticeVersion: string;
      acknowledgedAt: string;
    };
  },
): Promise<LargeAttachmentUploadSession> {
  await runMailBatch(db, [
    db.insert(schema.mailLargeAttachmentUploadSessions).values({
      id: input.id,
      actorUserId: input.actorUserId,
      draftId: input.draftId,
      mailboxId: input.mailboxId,
      storedFileId: null,
      storageKey: input.storageKey,
      expectedFilename: input.expectedFilename,
      expectedMimeType: input.expectedMimeType,
      expectedSizeBytes: input.expectedSizeBytes,
      maxSizeBytes: input.maxSizeBytes,
      declaredContentHash: input.declaredContentHash,
      expiresAt: input.expiresAt,
      finalizedAt: null,
      invalidatedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }),
    db.insert(schema.mailLargeAttachmentAcknowledgements).values({
      id: input.acknowledgement.id,
      uploadSessionId: input.id,
      lifecycleId: null,
      storedFileId: null,
      userId: input.acknowledgement.userId,
      draftId: input.draftId,
      mailboxId: input.mailboxId,
      noticeVersion: input.acknowledgement.noticeVersion,
      acknowledgedAt: input.acknowledgement.acknowledgedAt,
      createdAt: input.createdAt,
    }),
  ]);
  const created = await findUploadSessionById(db, input.id);
  if (!created) {
    throw new Error("Upload session insert failed");
  }
  return created;
}

export async function findLargeAttachmentAcknowledgementForSession(
  db: Database,
  input: { sessionId: string; userId: string },
) {
  const [row] = await db
    .select()
    .from(schema.mailLargeAttachmentAcknowledgements)
    .where(
      and(
        eq(
          schema.mailLargeAttachmentAcknowledgements.uploadSessionId,
          input.sessionId,
        ),
        eq(schema.mailLargeAttachmentAcknowledgements.userId, input.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function bindLargeAttachmentAcknowledgement(
  db: Database,
  input: {
    sessionId: string;
    userId: string;
    lifecycleId: string;
    storedFileId: string;
  },
): Promise<boolean> {
  const updated = await db
    .update(schema.mailLargeAttachmentAcknowledgements)
    .set({
      lifecycleId: input.lifecycleId,
      storedFileId: input.storedFileId,
    })
    .where(
      and(
        eq(
          schema.mailLargeAttachmentAcknowledgements.uploadSessionId,
          input.sessionId,
        ),
        eq(schema.mailLargeAttachmentAcknowledgements.userId, input.userId),
        isNull(schema.mailLargeAttachmentAcknowledgements.lifecycleId),
        isNull(schema.mailLargeAttachmentAcknowledgements.storedFileId),
      ),
    );
  return (updated.meta?.changes ?? 0) === 1;
}

export async function markUploadSessionFinalized(
  db: Database,
  input: {
    sessionId: string;
    storedFileId: string;
    finalizedAt: string;
  },
): Promise<void> {
  await db
    .update(schema.mailLargeAttachmentUploadSessions)
    .set({
      storedFileId: input.storedFileId,
      finalizedAt: input.finalizedAt,
      updatedAt: input.finalizedAt,
    })
    .where(eq(schema.mailLargeAttachmentUploadSessions.id, input.sessionId));
}

export async function invalidateUploadSession(
  db: Database,
  input: { sessionId: string; invalidatedAt: string },
): Promise<void> {
  await db
    .update(schema.mailLargeAttachmentUploadSessions)
    .set({
      invalidatedAt: input.invalidatedAt,
      updatedAt: input.invalidatedAt,
    })
    .where(eq(schema.mailLargeAttachmentUploadSessions.id, input.sessionId));
}
