import { and, count, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type { NotificationActionState } from "../../../drizzle/schema/notifications";
import type { User } from "../../../drizzle/schema/users";
import {
  isBulkMarkReadEligible,
  isLegacyPerCustomerReclaimWarningType,
  isPendingActionState,
  isReclamationSummaryType,
  isVisibleNotificationType,
  NOTIFICATION_ACTION_STATE,
} from "./action-state";
import { parseNotificationMessage } from "./i18n-storage";
import { recordNotificationBadgeAggregatePhysicalLoad } from "./notification-badge-instrumentation";

export type NotificationBadgeCounts = {
  unreadCount: number;
  pendingCount: number;
  unreadNonPendingCount: number;
  attentionCount: number;
};

export type NotificationListItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  related_entity_missing?: boolean;
  is_read: boolean;
  action_state: NotificationActionState;
  grouping_key: string | null;
  summary_scope: string | null;
  action_updated_at: string | null;
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
    action_state: row.actionState,
    grouping_key: row.groupingKey,
    summary_scope: row.summaryScope,
    action_updated_at: row.actionUpdatedAt,
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
    .limit(limit * 2);

  const filtered = rows
    .filter((row) => isVisibleNotificationType(row.type))
    .slice(0, limit);

  return attachRelatedEntityMissingFlags(db, filtered.map(toListItem));
}

function visibleNotificationCondition() {
  return sql`${schema.notifications.type} NOT IN ('auto_reclaim_warning_day_6', 'auto_reclaim_warning_day_7')`;
}

export function pendingActionCountWhere(userId?: string) {
  const conditions = [
    eq(schema.notifications.actionState, NOTIFICATION_ACTION_STATE.pending),
    visibleNotificationCondition(),
  ];
  if (userId) {
    conditions.push(eq(schema.notifications.userId, userId));
  }
  return and(...conditions)!;
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
        visibleNotificationCondition(),
      ),
    );
  return row[0]?.value ?? 0;
}

export async function getUnreadNonPendingNotificationCount(
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
        ne(schema.notifications.actionState, NOTIFICATION_ACTION_STATE.pending),
        visibleNotificationCondition(),
      ),
    );
  return row[0]?.value ?? 0;
}

export async function getPendingActionCount(
  db: Database,
  userId: string,
): Promise<number> {
  const row = await db
    .select({ value: count() })
    .from(schema.notifications)
    .where(pendingActionCountWhere(userId));
  return row[0]?.value ?? 0;
}

/** One aggregate query for Work Items badge counts and unread-count API. */
export async function getNotificationBadgeCounts(
  db: Database,
  userId: string,
): Promise<NotificationBadgeCounts> {
  recordNotificationBadgeAggregatePhysicalLoad();

  const [row] = await db
    .select({
      unreadCount:
        sql<number>`sum(case when ${schema.notifications.isRead} = 0 then 1 else 0 end)`.mapWith(
          Number,
        ),
      pendingCount:
        sql<number>`sum(case when ${schema.notifications.actionState} = ${NOTIFICATION_ACTION_STATE.pending} then 1 else 0 end)`.mapWith(
          Number,
        ),
      unreadNonPendingCount:
        sql<number>`sum(case when ${schema.notifications.isRead} = 0 and ${schema.notifications.actionState} != ${NOTIFICATION_ACTION_STATE.pending} then 1 else 0 end)`.mapWith(
          Number,
        ),
    })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.userId, userId), visibleNotificationCondition()),
    );

  const pendingCount = Number(row?.pendingCount ?? 0);
  const unreadNonPendingCount = Number(row?.unreadNonPendingCount ?? 0);

  return {
    unreadCount: Number(row?.unreadCount ?? 0),
    pendingCount,
    unreadNonPendingCount,
    attentionCount: pendingCount + unreadNonPendingCount,
  };
}

export async function getPendingActionCountsByUserIds(
  db: Database,
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      userId: schema.notifications.userId,
      value: count().mapWith(Number),
    })
    .from(schema.notifications)
    .where(
      and(inArray(schema.notifications.userId, userIds), pendingActionCountWhere()),
    )
    .groupBy(schema.notifications.userId);

  return new Map(rows.map((row) => [row.userId, Number(row.value ?? 0)]));
}

export async function getWorkItemsAttentionCount(
  db: Database,
  userId: string,
): Promise<number> {
  const [pending, unreadNonPending] = await Promise.all([
    getPendingActionCount(db, userId),
    getUnreadNonPendingNotificationCount(db, userId),
  ]);
  return pending + unreadNonPending;
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

export type MarkAllReadResult = {
  markedCount: number;
  retainedCount: number;
};

export async function markAllNotificationsRead(
  db: Database,
  userId: string,
): Promise<MarkAllReadResult> {
  const unread = await db
    .select({
      actionState: schema.notifications.actionState,
      type: schema.notifications.type,
    })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.isRead, 0),
      ),
    );

  let markedCount = 0;
  let retainedCount = 0;
  for (const row of unread) {
    if (
      isBulkMarkReadEligible(row.actionState) &&
      !isLegacyPerCustomerReclaimWarningType(row.type)
    ) {
      markedCount += 1;
    } else {
      retainedCount += 1;
    }
  }

  if (markedCount === 0) {
    return { markedCount: 0, retainedCount };
  }

  await db
    .update(schema.notifications)
    .set({ isRead: 1 })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.isRead, 0),
        or(
          eq(
            schema.notifications.actionState,
            NOTIFICATION_ACTION_STATE.informational,
          ),
          eq(
            schema.notifications.actionState,
            NOTIFICATION_ACTION_STATE.completed,
          ),
          eq(
            schema.notifications.actionState,
            NOTIFICATION_ACTION_STATE.expired,
          ),
        ),
      ),
    );

  return { markedCount, retainedCount };
}

function extractNotificationUpdateChanges(result: unknown): number {
  if (
    result &&
    typeof result === "object" &&
    "meta" in result &&
    result.meta &&
    typeof result.meta === "object" &&
    "changes" in result.meta &&
    typeof (result.meta as { changes: unknown }).changes === "number"
  ) {
    return (result.meta as { changes: number }).changes;
  }
  return 0;
}

export async function markApprovalPendingNotificationsRead(
  db: Database,
  approvalId: string,
): Promise<{ markedReadCount: number }> {
  const result = await db
    .update(schema.notifications)
    .set({ isRead: 1 })
    .where(
      and(
        eq(schema.notifications.type, "approval.pending"),
        eq(schema.notifications.relatedEntityType, "approval"),
        eq(schema.notifications.relatedEntityId, approvalId),
        eq(schema.notifications.isRead, 0),
      ),
    );

  return { markedReadCount: extractNotificationUpdateChanges(result) };
}

export function buildMarkApprovalNotificationsReadForCustomerStatement(
  db: Database,
  customerId: string,
) {
  return db
    .update(schema.notifications)
    .set({ isRead: 1 })
    .where(
      and(
        eq(schema.notifications.isRead, 0),
        eq(schema.notifications.relatedEntityType, "approval"),
        inArray(
          schema.notifications.relatedEntityId,
          db
            .select({ id: schema.approvals.id })
            .from(schema.approvals)
            .where(eq(schema.approvals.customerId, customerId)),
        ),
      ),
    );
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
    | "type"
    | "related_entity_type"
    | "related_entity_id"
    | "related_entity_missing"
    | "summary_scope"
  >,
  role: User["role"],
): string | null {
  if (isReclamationSummaryType(item.type)) {
    if (item.summary_scope === "admin_team" && role === "admin") {
      return "/customers?reclamationRisk=team";
    }
    if (item.summary_scope === "staff_self") {
      return "/customers?reclamationRisk=mine";
    }
    return null;
  }

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

export function getNotificationVisualPriority(
  item: Pick<NotificationListItem, "type" | "action_state" | "message">,
): "normal" | "important" | "urgent" | "tomorrow" | "completed" | "expired" {
  if (item.action_state === NOTIFICATION_ACTION_STATE.completed) {
    return "completed";
  }
  if (item.action_state === NOTIFICATION_ACTION_STATE.expired) {
    return "expired";
  }
  if (!isPendingActionState(item.action_state)) {
    return "normal";
  }
  if (
    item.type === "reclamation.summary.staff" ||
    item.type === "reclamation.summary.admin"
  ) {
    const parsed = parseNotificationMessage(item.message);
    const tomorrow = Number(parsed?.params?.tomorrowCount ?? 0);
    if (tomorrow > 0) return "tomorrow";
    const urgent = Number(parsed?.params?.urgentCount ?? 0);
    if (urgent > 0) return "urgent";
    return "important";
  }
  if (item.type === "approval.pending") {
    return "urgent";
  }
  return "important";
}
