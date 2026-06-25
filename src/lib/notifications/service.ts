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
