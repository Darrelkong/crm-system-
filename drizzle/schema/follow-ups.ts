import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { users } from "./users";

export const followUps = sqliteTable(
  "follow_ups",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    followUpTime: text("follow_up_time").notNull(),
    channel: text("channel").notNull(),
    outcome: text("outcome").notNull(),
    summary: text("summary").notNull(),
    customerIntent: text("customer_intent"),
    nextFollowUpAt: text("next_follow_up_at"),
    nextAction: text("next_action"),
    isValidFollowUp: integer("is_valid_follow_up").notNull().default(0),
    /** @deprecated legacy column — use summary */
    content: text("content"),
    /** @deprecated legacy column — use channel */
    followUpType: text("follow_up_type"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_follow_ups_customer_id").on(table.customerId),
    index("idx_follow_ups_user_id").on(table.userId),
    index("idx_follow_ups_follow_up_time").on(table.followUpTime),
  ],
);

export type FollowUp = typeof followUps.$inferSelect;
export type NewFollowUp = typeof followUps.$inferInsert;
