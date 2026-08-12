import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { customerHouseholds } from "./customer-households";
import { users } from "./users";

/**
 * Customer ↔ Household membership.
 * Active membership: left_at IS NULL.
 * Historical membership: left_at IS NOT NULL.
 *
 * Partial unique index (one active household per customer) is defined in
 * migration 0046 — not expressible in Drizzle schema alone.
 */
export const customerHouseholdMembers = sqliteTable(
  "customer_household_members",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => customerHouseholds.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    joinedAt: text("joined_at").notNull(),
    joinedBy: text("joined_by")
      .notNull()
      .references(() => users.id),
    leftAt: text("left_at"),
    removedBy: text("removed_by").references(() => users.id),
  },
  (table) => [
    index("idx_customer_household_members_household_id").on(table.householdId),
    index("idx_customer_household_members_customer_id").on(table.customerId),
  ],
);

export type CustomerHouseholdMember =
  typeof customerHouseholdMembers.$inferSelect;
export type NewCustomerHouseholdMember =
  typeof customerHouseholdMembers.$inferInsert;
