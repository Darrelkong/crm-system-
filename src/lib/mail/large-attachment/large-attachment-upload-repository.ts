import { eq } from "drizzle-orm";
import type { MailLargeAttachmentUploadSession } from "../../../../drizzle/schema/mail-large-attachment-upload-sessions";
import { schema, type Database } from "@/lib/db";
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
  },
): Promise<LargeAttachmentUploadSession> {
  await db.insert(schema.mailLargeAttachmentUploadSessions).values({
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
  });
  const created = await findUploadSessionById(db, input.id);
  if (!created) {
    throw new Error("Upload session insert failed");
  }
  return created;
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
