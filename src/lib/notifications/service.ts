import { and, asc, eq, type SQL } from "drizzle-orm";
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

export type BuildCreateNotificationStatementInput = CreateNotificationInput & {
  id: string;
  createdAt: string;
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

function resolveNotificationTitle(input: CreateNotificationInput): string {
  if (input.titleKey != null) {
    return storeNotificationTitle(input.titleKey);
  }
  return input.title ?? storeNotificationTitle(notificationTypeToTitleKey(input.type));
}

function resolveNotificationMessage(input: CreateNotificationInput): string {
  if (input.messageKey != null) {
    return storeNotificationMessage(input.messageKey, input.messageParams);
  }
  return input.message ?? "";
}

/**
 * Returns a single notifications INSERT statement for use inside db.batch.
 * Does not execute. Callers must supply id and createdAt.
 */
export function buildCreateNotificationStatement(
  db: Database,
  input: BuildCreateNotificationStatementInput,
) {
  return db.insert(schema.notifications).values({
    id: input.id,
    userId: input.userId,
    type: input.type,
    title: resolveNotificationTitle(input),
    message: resolveNotificationMessage(input),
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    isRead: 0,
    createdAt: input.createdAt,
  });
}

/**
 * Returns a notifications INSERT…SELECT statement for use inside db.batch.
 * Does not execute. selectSql must project notification column values;
 * typically SELECT … FROM customers WHERE snapshot CAS predicates.
 */
export function buildCreateNotificationInsertSelectStatement(
  db: Database,
  selectSql: SQL,
) {
  return db.insert(schema.notifications).select(selectSql);
}

/** Resolve stored title/message the same way as createNotification. */
export function resolveCreateNotificationContent(
  input: CreateNotificationInput,
): { title: string; message: string } {
  return {
    title: resolveNotificationTitle(input),
    message: resolveNotificationMessage(input),
  };
}

export async function createNotification(
  db: Database,
  input: CreateNotificationInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await buildCreateNotificationStatement(db, {
    ...input,
    id,
    createdAt,
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
