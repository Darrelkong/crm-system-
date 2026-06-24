import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { users } from "./users";

export const fieldChangeLogs = sqliteTable(
  "field_change_logs",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    changedBy: text("changed_by")
      .notNull()
      .references(() => users.id),
    changedAt: text("changed_at").notNull(),
  },
  (table) => [
    index("idx_field_change_logs_customer_id").on(table.customerId),
    index("idx_field_change_logs_changed_at").on(table.changedAt),
  ],
);

export type FieldChangeLog = typeof fieldChangeLogs.$inferSelect;
export type NewFieldChangeLog = typeof fieldChangeLogs.$inferInsert;
