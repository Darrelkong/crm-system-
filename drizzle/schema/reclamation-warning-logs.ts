import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { users } from "./users";

export const RECLAMATION_WARNING_TYPES = ["day_6", "day_7"] as const;
export type ReclamationWarningType =
  (typeof RECLAMATION_WARNING_TYPES)[number];

/** Prevents duplicate day-6 / day-7 warnings for the same customer on the same calendar day. */
export const reclamationWarningLogs = sqliteTable(
  "reclamation_warning_logs",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    warningType: text("warning_type", { enum: RECLAMATION_WARNING_TYPES }).notNull(),
    warningDate: text("warning_date").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_reclamation_warning_unique").on(
      table.customerId,
      table.warningType,
      table.warningDate,
    ),
    index("idx_reclamation_warning_customer").on(table.customerId),
  ],
);

export type ReclamationWarningLog =
  typeof reclamationWarningLogs.$inferSelect;
