import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const NOTIFICATION_TYPES = [
  "auto_reclaim_warning_day_6",
  "auto_reclaim_warning_day_7",
  "customer_auto_reclaimed",
  "reclamation.summary.staff",
  "reclamation.summary.admin",
  "approval.pending",
  "approval.approved",
  "approval.rejected",
  "customer.transferred",
  "customer.collaborator_added",
  "customer.collaborator_removed",
  "customer.closed_won.approved",
  "customer.pending_second_conversion",
  "backup_failed",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_ACTION_STATES = [
  "informational",
  "pending",
  "completed",
  "expired",
] as const;

export type NotificationActionState =
  (typeof NOTIFICATION_ACTION_STATES)[number];

export const NOTIFICATION_SUMMARY_SCOPES = [
  "staff_self",
  "admin_team",
] as const;

export type NotificationSummaryScope =
  (typeof NOTIFICATION_SUMMARY_SCOPES)[number];

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: text("related_entity_id"),
    isRead: integer("is_read").notNull().default(0),
    actionState: text("action_state", {
      enum: NOTIFICATION_ACTION_STATES,
    })
      .notNull()
      .default("informational"),
    groupingKey: text("grouping_key"),
    actionUpdatedAt: text("action_updated_at"),
    summaryScope: text("summary_scope", {
      enum: NOTIFICATION_SUMMARY_SCOPES,
    }),
    summaryFingerprint: text("summary_fingerprint"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_notifications_user_id").on(table.userId),
    index("idx_notifications_created_at").on(table.createdAt),
    index("idx_notifications_related").on(
      table.relatedEntityType,
      table.relatedEntityId,
    ),
    index("idx_notifications_user_action").on(table.userId, table.actionState),
    uniqueIndex("idx_notifications_user_grouping_pending")
      .on(table.userId, table.groupingKey)
      .where(
        sql`${table.actionState} = 'pending' AND ${table.groupingKey} IS NOT NULL`,
      ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
