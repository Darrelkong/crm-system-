import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { NotificationType } from "../../../drizzle/schema/notifications";
import {
  notificationTypeToTitleKey,
  storeNotificationMessage,
  storeNotificationTitle,
} from "./i18n-storage";

type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title?: string;
  message?: string;
  titleKey?: string;
  messageKey?: string;
  messageParams?: Record<string, string>;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
};

export type CreateEntityNotificationOnceInput = {
  userId: string;
  type: NotificationType;
  relatedEntityType: string;
  relatedEntityId: string;
  title?: string;
  message?: string;
  titleKey?: string;
  messageKey?: string;
  messageParams?: Record<string, string>;
};

export type CreateNotificationOnceResult = {
  id: string;
  created: boolean;
};

export async function createNotification(
  db: Database,
  input: CreateNotificationInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const title =
    input.titleKey != null
      ? storeNotificationTitle(input.titleKey)
      : input.title ?? storeNotificationTitle(notificationTypeToTitleKey(input.type));

  const message =
    input.messageKey != null
      ? storeNotificationMessage(input.messageKey, input.messageParams)
      : (input.message ?? "");

  await db.insert(schema.notifications).values({
    id,
    userId: input.userId,
    type: input.type,
    title,
    message,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    isRead: 0,
    createdAt: now,
  });

  return id;
}

/**
 * Application-layer natural-key dedup for notifications that have a full
 * entity identity (relatedEntityType + relatedEntityId both required).
 *
 * Natural key: userId + type + relatedEntityType + relatedEntityId.
 * Does not use title/message/isRead/createdAt. Does not mutate existing rows.
 * SELECT+INSERT still has a tiny race window; DB unique is deferred to A2.
 */
export async function createNotificationOnce(
  db: Database,
  input: CreateEntityNotificationOnceInput,
): Promise<CreateNotificationOnceResult> {
  const existing = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, input.userId),
        eq(schema.notifications.type, input.type),
        eq(schema.notifications.relatedEntityType, input.relatedEntityType),
        eq(schema.notifications.relatedEntityId, input.relatedEntityId),
      ),
    )
    .orderBy(
      asc(schema.notifications.createdAt),
      asc(schema.notifications.id),
    )
    .limit(1);

  const existingId = existing[0]?.id;
  if (existingId) {
    return { id: existingId, created: false };
  }

  const id = await createNotification(db, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    titleKey: input.titleKey,
    messageKey: input.messageKey,
    messageParams: input.messageParams,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
  });

  return { id, created: true };
}
