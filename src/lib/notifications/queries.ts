import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export type NotificationListItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  /** True when related_entity_type is customer and the row no longer exists. */
  related_entity_missing?: boolean;
  is_read: boolean;
  created_at: string;
};

function toListItem(row: typeof schema.notifications.$inferSelect): NotificationListItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    related_entity_type: row.relatedEntityType,
    related_entity_id: row.relatedEntityId,
    is_read: row.isRead === 1,
    created_at: row.createdAt,
  };
}

async function attachRelatedEntityMissingFlags(
  db: Database,
  items: NotificationListItem[],
): Promise<NotificationListItem[]> {
  const customerIds = [
    ...new Set(
      items
        .filter(
          (item) =>
            item.related_entity_type === "customer" &&
            item.related_entity_id != null,
        )
        .map((item) => item.related_entity_id as string),
    ),
  ];

  if (customerIds.length === 0) {
    return items;
  }

  const existingRows = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(inArray(schema.customers.id, customerIds));

  const existingIds = new Set(existingRows.map((row) => row.id));

  return items.map((item) => {
    if (item.related_entity_type !== "customer" || !item.related_entity_id) {
      return item;
    }

    if (existingIds.has(item.related_entity_id)) {
      return item;
    }

    return { ...item, related_entity_missing: true };
  });
}

export async function listNotificationsForUser(
  db: Database,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationListItem[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const conditions = [eq(schema.notifications.userId, userId)];

  if (options.unreadOnly) {
    conditions.push(eq(schema.notifications.isRead, 0));
  }

  const rows = await db
    .select()
    .from(schema.notifications)
    .where(and(...conditions))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);

  return attachRelatedEntityMissingFlags(db, rows.map(toListItem));
}

export async function getUnreadNotificationCount(
  db: Database,
  userId: string,
): Promise<number> {
  const row = await db
    .select({ value: count() })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.isRead, 0),
      ),
    );
  return row[0]?.value ?? 0;
}

export async function getNotificationById(
  db: Database,
  notificationId: string,
) {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.id, notificationId))
    .limit(1);
  return rows[0] ?? null;
}

export type MarkReadResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "forbidden" };

export async function markNotificationRead(
  db: Database,
  userId: string,
  notificationId: string,
): Promise<MarkReadResult> {
  const row = await getNotificationById(db, notificationId);
  if (!row) {
    return { ok: false, reason: "not_found" };
  }
  if (row.userId !== userId) {
    return { ok: false, reason: "forbidden" };
  }
  if (row.isRead === 1) {
    return { ok: true };
  }

  const now = new Date().toISOString();
  await db
    .update(schema.notifications)
    .set({ isRead: 1 })
    .where(
      and(
        eq(schema.notifications.id, notificationId),
        eq(schema.notifications.userId, userId),
      ),
    );

  return { ok: true };
}

export async function markAllNotificationsRead(
  db: Database,
  userId: string,
): Promise<number> {
  const unread = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.isRead, 0),
      ),
    );

  if (unread.length === 0) {
    return 0;
  }

  await db
    .update(schema.notifications)
    .set({ isRead: 1 })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.isRead, 0),
      ),
    );

  return unread.length;
}

export function isRelatedCustomerMissing(
  item: Pick<
    NotificationListItem,
    "related_entity_type" | "related_entity_missing"
  >,
): boolean {
  return (
    item.related_entity_type === "customer" &&
    item.related_entity_missing === true
  );
}

export function getNotificationHref(
  item: Pick<
    NotificationListItem,
    "related_entity_type" | "related_entity_id" | "related_entity_missing"
  >,
  role: User["role"],
): string | null {
  if (!item.related_entity_type || !item.related_entity_id) {
    return null;
  }

  if (item.related_entity_missing) {
    return null;
  }

  switch (item.related_entity_type) {
    case "customer":
      return `/customers/${item.related_entity_id}`;
    case "approval":
      return "/approvals";
    case "backup_job":
    case "backup":
      return role === "admin" ? "/admin/backups" : null;
    default:
      return null;
  }
}
