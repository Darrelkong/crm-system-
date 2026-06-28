import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { customers } from "./customers";
import { users } from "./users";

export const APPROVAL_REQUEST_TYPES = [
  "delete_customer",
  "transfer_customer",
  "merge_customers",
  "closed_won",
  "second_conversion",
  "create_on_hold_customer",
] as const;

export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    requestType: text("request_type", { enum: APPROVAL_REQUEST_TYPES }).notNull(),
    status: text("status", { enum: APPROVAL_STATUSES })
      .notNull()
      .default("pending"),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    targetUserId: text("target_user_id").references(() => users.id),
    relatedCustomerIds: text("related_customer_ids"),
    payload: text("payload"),
    reason: text("reason").notNull(),
    adminComment: text("admin_comment"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_approvals_status").on(table.status),
    index("idx_approvals_customer_id").on(table.customerId),
    index("idx_approvals_requested_by").on(table.requestedBy),
    index("idx_approvals_pending_lookup").on(
      table.customerId,
      table.requestType,
      table.status,
    ),
  ],
);

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
