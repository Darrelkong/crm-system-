import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { NotificationType } from "../../../drizzle/schema/notifications";

type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
};

export async function createNotification(
  db: Database,
  input: CreateNotificationInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(schema.notifications).values({
    id,
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    isRead: 0,
    createdAt: now,
  });

  return id;
}
