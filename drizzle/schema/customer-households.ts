import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { users } from "./users";

export const CUSTOMER_HOUSEHOLD_STATUSES = ["active", "dissolved"] as const;

export type CustomerHouseholdStatus =
  (typeof CUSTOMER_HOUSEHOLD_STATUSES)[number];

/**
 * Family / Household container — relationship metadata only.
 * Must not own Customer business state (stage, owner, follow-ups, etc.).
 */
export const customerHouseholds = sqliteTable(
  "customer_households",
  {
    id: text("id").primaryKey(),
    status: text("status", { enum: CUSTOMER_HOUSEHOLD_STATUSES })
      .notNull()
      .default("active"),
    /** Provenance only — household must not depend on this Customer for lifecycle. */
    createdFromCustomerId: text("created_from_customer_id").references(
      () => customers.id,
      { onDelete: "set null" },
    ),
    remark: text("remark"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    dissolvedAt: text("dissolved_at"),
    dissolvedBy: text("dissolved_by").references(() => users.id),
  },
  (table) => [
    index("idx_customer_households_status").on(table.status),
    index("idx_customer_households_created_from_customer_id").on(
      table.createdFromCustomerId,
    ),
  ],
);

export type CustomerHousehold = typeof customerHouseholds.$inferSelect;
export type NewCustomerHousehold = typeof customerHouseholds.$inferInsert;
