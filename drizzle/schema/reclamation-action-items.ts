import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { followUps } from "./follow-ups";
import { users } from "./users";

export const RECLAMATION_ACTION_STATES = [
  "pending",
  "completed",
  "expired",
] as const;

export type ReclamationActionState =
  (typeof RECLAMATION_ACTION_STATES)[number];

export const RECLAMATION_RISK_BANDS = [
  "tomorrow",
  "within_7",
  "within_14",
  "routine",
] as const;

export type ReclamationRiskBand = (typeof RECLAMATION_RISK_BANDS)[number];

export const reclamationActionItems = sqliteTable(
  "reclamation_action_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    cycleStartedAt: text("cycle_started_at").notNull(),
    actionState: text("action_state", {
      enum: RECLAMATION_ACTION_STATES,
    }).notNull(),
    riskBand: text("risk_band", { enum: RECLAMATION_RISK_BANDS }).notNull(),
    idleDays: integer("idle_days").notNull(),
    reclaimDaysSnapshot: integer("reclaim_days_snapshot").notNull(),
    completedAt: text("completed_at"),
    expiredAt: text("expired_at"),
    completedFollowUpId: text("completed_follow_up_id").references(
      () => followUps.id,
    ),
    expireReason: text("expire_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_reclamation_action_items_owner_cycle").on(
      table.customerId,
      table.cycleStartedAt,
      table.userId,
    ),
    index("idx_reclamation_action_items_user_state").on(
      table.userId,
      table.actionState,
    ),
  ],
);

export type ReclamationActionItem =
  typeof reclamationActionItems.$inferSelect;
