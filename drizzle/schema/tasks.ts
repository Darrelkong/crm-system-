import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { users } from "./users";

export const TASK_STATUSES = ["open", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPES = ["follow_up", "other"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

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
    type: text("type", { enum: TASK_TYPES }).notNull().default("follow_up"),
    status: text("status", { enum: TASK_STATUSES })
      .notNull()
      .default("open"),
    dueAt: text("due_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_tasks_assigned_to").on(table.assignedTo),
    index("idx_tasks_customer_id").on(table.customerId),
    index("idx_tasks_status").on(table.status),
    index("idx_tasks_due_at").on(table.dueAt),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
