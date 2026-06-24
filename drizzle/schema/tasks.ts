import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { users } from "./users";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    assignedTo: text("assigned_to")
      .notNull()
      .references(() => users.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["pending", "in_progress", "done", "cancelled"],
    })
      .notNull()
      .default("pending"),
    dueAt: text("due_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_tasks_assigned_to").on(table.assignedTo),
    index("idx_tasks_customer_id").on(table.customerId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
