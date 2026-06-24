import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const NOTIFICATION_TYPES = [
  "auto_reclaim_warning_day_6",
  "auto_reclaim_warning_day_7",
  "customer_auto_reclaimed",
  "approval.pending",
  "approval.approved",
  "approval.rejected",
  "customer.transferred",
  "customer.closed_won.approved",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

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
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_notifications_user_id").on(table.userId),
    index("idx_notifications_created_at").on(table.createdAt),
    index("idx_notifications_related").on(
      table.relatedEntityType,
      table.relatedEntityId,
    ),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
