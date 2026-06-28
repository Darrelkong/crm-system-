import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { users } from "./users";

export const CUSTOMER_ASSIGNEE_ROLES = ["primary", "collaborator"] as const;

export type CustomerAssigneeRole = (typeof CUSTOMER_ASSIGNEE_ROLES)[number];

export const customerAssignees = sqliteTable(
  "customer_assignees",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: CUSTOMER_ASSIGNEE_ROLES })
      .notNull()
      .default("collaborator"),
    assignedBy: text("assigned_by").references(() => users.id),
    assignedAt: text("assigned_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_customer_assignees_customer_user").on(
      table.customerId,
      table.userId,
    ),
    index("idx_customer_assignees_user_id").on(table.userId),
    index("idx_customer_assignees_customer_id").on(table.customerId),
  ],
);

export type CustomerAssignee = typeof customerAssignees.$inferSelect;
export type NewCustomerAssignee = typeof customerAssignees.$inferInsert;
