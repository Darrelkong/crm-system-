import { and, eq } from "drizzle-orm";
import type { MailNotificationOutbox } from "../../../drizzle/schema/mail-notification-outbox";
import type { MailNotificationType } from "../../../drizzle/schema/mail-notification-outbox";
import { schema, type Database } from "@/lib/db";
import { MailServiceError } from "@/lib/mail/errors";
import { findNotificationIdentityById } from "@/lib/mail/notification-identity-service";
import { isNotificationType } from "@/lib/mail/notification-outbox-constants";

export type EnqueueMailNotificationIntentInput = {
  notificationType: MailNotificationType;
  recipientUserId: string;
  notificationIdentityId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  mailboxId?: string | null;
};

export type EnqueueMailNotificationIntentResult = {
  outbox: MailNotificationOutbox;
  created: boolean;
};

function isUniqueConstraintError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /UNIQUE constraint failed/i.test(message);
}

async function findOutboxBySemanticKey(
  db: Database,
  input: EnqueueMailNotificationIntentInput,
): Promise<MailNotificationOutbox | null> {
  const [row] = await db
    .select()
    .from(schema.mailNotificationOutbox)
    .where(
      and(
        eq(schema.mailNotificationOutbox.notificationType, input.notificationType),
        eq(schema.mailNotificationOutbox.sourceEntityType, input.sourceEntityType),
        eq(schema.mailNotificationOutbox.sourceEntityId, input.sourceEntityId),
        eq(schema.mailNotificationOutbox.recipientUserId, input.recipientUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Idempotent notification intent enqueue — no transport side effects.
 * Caller supplies server-resolved identity and source metadata only.
 */
export async function enqueueMailNotificationIntent(
  db: Database,
  input: EnqueueMailNotificationIntentInput,
): Promise<EnqueueMailNotificationIntentResult> {
  if (!isNotificationType(input.notificationType)) {
    throw MailServiceError.validation("Invalid notification type");
  }
  if (!input.sourceEntityType.trim() || !input.sourceEntityId.trim()) {
    throw MailServiceError.validation("Source entity identity is required");
  }

  const identity = await findNotificationIdentityById(
    db,
    input.notificationIdentityId,
  );
  if (!identity) {
    throw MailServiceError.notFound("Notification identity not found");
  }
  if (identity.userId !== input.recipientUserId) {
    throw MailServiceError.validation(
      "Notification identity does not belong to recipient user",
    );
  }

  const existing = await findOutboxBySemanticKey(db, input);
  if (existing) {
    return { outbox: existing, created: false };
  }

  const now = new Date().toISOString();
  const outboxId = crypto.randomUUID();

  try {
    await db.insert(schema.mailNotificationOutbox).values({
      id: outboxId,
      notificationType: input.notificationType,
      recipientUserId: input.recipientUserId,
      notificationIdentityId: input.notificationIdentityId,
      sourceEntityType: input.sourceEntityType.trim(),
      sourceEntityId: input.sourceEntityId.trim(),
      mailboxId: input.mailboxId ?? null,
      status: "pending",
      processingVersion: 1,
      enqueuedAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const raced = await findOutboxBySemanticKey(db, input);
      if (raced) {
        return { outbox: raced, created: false };
      }
    }
    throw error;
  }

  const [outbox] = await db
    .select()
    .from(schema.mailNotificationOutbox)
    .where(eq(schema.mailNotificationOutbox.id, outboxId))
    .limit(1);
  if (!outbox) {
    throw MailServiceError.integrityConflict("Notification outbox insert failed");
  }
  return { outbox, created: true };
}
