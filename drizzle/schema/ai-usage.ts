import {
  index,
  integer,
  sqliteTable,
  text,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const AI_USAGE_OPERATION_TYPES = [
  "deep_analysis_refresh",
  "follow_up_organization",
] as const;
export type AiUsageOperationType = (typeof AI_USAGE_OPERATION_TYPES)[number];

export const AI_USAGE_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "expired",
] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];

/** Per-staff Hong Kong calendar-day quota counters (reserved includes pending + succeeded). */
export const aiStaffDailyQuota = sqliteTable(
  "ai_staff_daily_quota",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    usageDate: text("usage_date").notNull(),
    reservedCount: integer("reserved_count").notNull().default(0),
    succeededCount: integer("succeeded_count").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.usageDate] }),
    index("idx_ai_staff_daily_quota_usage_date").on(table.usageDate),
  ],
);

/**
 * Per-call usage events for staff external AI deep analysis.
 * Does not store prompts, responses, or customer PII payloads.
 */
export const aiUsageEvents = sqliteTable(
  "ai_usage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    usageDate: text("usage_date").notNull(),
    operationType: text("operation_type").notNull(),
    status: text("status").notNull(),
    reservationKey: text("reservation_key").notNull(),
    customerId: text("customer_id"),
    provider: text("provider"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("uq_ai_usage_events_reservation_key").on(table.reservationKey),
    index("idx_ai_usage_events_user_date_status").on(
      table.userId,
      table.usageDate,
      table.status,
    ),
    index("idx_ai_usage_events_created_at").on(table.createdAt),
  ],
);

export type AiStaffDailyQuota = typeof aiStaffDailyQuota.$inferSelect;
export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
