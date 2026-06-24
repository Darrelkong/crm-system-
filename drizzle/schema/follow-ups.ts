import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
    content: text("content").notNull(),
    followUpType: text("follow_up_type"),
    nextFollowUpAt: text("next_follow_up_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_follow_ups_customer_id").on(table.customerId),
    index("idx_follow_ups_user_id").on(table.userId),
  ],
);

export type FollowUp = typeof followUps.$inferSelect;
export type NewFollowUp = typeof followUps.$inferInsert;
