import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MailServiceError } from "@/lib/mail/errors";
import {
  toMailMessageReadStateView,
  type MailMessageReadStateView,
} from "@/lib/mail/mail-read-state-projection";
import {
  assertCanReadMessage,
  type MailMessageReadContext,
} from "@/lib/mail/message-read-permissions";

export type MessageReadStatePatch = {
  isRead?: boolean;
  isImportantPersonal?: boolean;
};

function assertPatchHasFields(patch: MessageReadStatePatch): void {
  if (patch.isRead === undefined && patch.isImportantPersonal === undefined) {
    throw MailServiceError.validation(
      "At least one read state field is required",
    );
  }
}

async function findReadStateForActor(
  db: Database,
  actor: MailActorContext,
  messageId: string,
) {
  const [row] = await db
    .select()
    .from(schema.mailMessageReadStates)
    .where(
      and(
        eq(schema.mailMessageReadStates.messageId, messageId),
        eq(schema.mailMessageReadStates.userId, actor.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Upserts per-user read/unread and personal-important state for one message.
 */
export async function updateMessageReadState(
  db: Database,
  actor: MailActorContext,
  messageId: string,
  patch: MessageReadStatePatch,
  context?: MailMessageReadContext,
): Promise<MailMessageReadStateView> {
  assertPatchHasFields(patch);
  await assertCanReadMessage(db, actor, messageId, context);

  const existing = await findReadStateForActor(db, actor, messageId);
  const now = new Date().toISOString();

  const nextIsRead =
    patch.isRead !== undefined ? patch.isRead : existing?.isRead === 1;
  const nextImportant =
    patch.isImportantPersonal !== undefined
      ? patch.isImportantPersonal
      : existing?.isImportantPersonal === 1;

  let nextReadAt: string | null = null;
  if (nextIsRead) {
    if (
      patch.isRead === true &&
      existing?.isRead === 1 &&
      existing.readAt != null
    ) {
      nextReadAt = existing.readAt;
    } else {
      nextReadAt = now;
    }
  }

  const needsPersistedRow = existing != null || nextIsRead || nextImportant;

  if (!needsPersistedRow) {
    return toMailMessageReadStateView(messageId, null);
  }

  if (existing) {
    const [updated] = await db
      .update(schema.mailMessageReadStates)
      .set({
        isRead: nextIsRead ? 1 : 0,
        readAt: nextReadAt,
        isImportantPersonal: nextImportant ? 1 : 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailMessageReadStates.messageId, messageId),
          eq(schema.mailMessageReadStates.userId, actor.userId),
        ),
      )
      .returning();

    if (!updated) {
      throw MailServiceError.notFound("Message read state not found");
    }

    return toMailMessageReadStateView(messageId, updated);
  }

  const [inserted] = await db
    .insert(schema.mailMessageReadStates)
    .values({
      messageId,
      userId: actor.userId,
      isRead: nextIsRead ? 1 : 0,
      readAt: nextReadAt,
      isImportantPersonal: nextImportant ? 1 : 0,
      updatedAt: now,
    })
    .returning();

  return toMailMessageReadStateView(messageId, inserted!);
}

export async function getMessageReadStateForActor(
  db: Database,
  actor: MailActorContext,
  messageId: string,
): Promise<MailMessageReadStateView> {
  const row = await findReadStateForActor(db, actor, messageId);
  return toMailMessageReadStateView(messageId, row);
}
