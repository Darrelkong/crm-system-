import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const CUSTOMER_STATUSES = [
  "active",
  "inactive",
  "archived",
  "public_pool",
] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    customerName: text("customer_name").notNull(),
    customerType: text("customer_type").notNull().default("individual"),
    phoneCountryCode: text("phone_country_code").notNull().default("+86"),
    phone: text("phone"),
    wechatId: text("wechat_id"),
    email: text("email"),
    source: text("source").notNull(),
    sourceRemark: text("source_remark"),
    notes: text("notes"),
    salesStage: text("sales_stage").notNull().default("new_lead"),
    ownerId: text("owner_id").references(() => users.id),
    status: text("status", { enum: CUSTOMER_STATUSES })
      .notNull()
      .default("active"),
    releaserUserId: text("releaser_user_id").references(() => users.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
    lastFollowUpAt: text("last_follow_up_at"),
    lastValidFollowUpAt: text("last_valid_follow_up_at"),
    nextFollowUpAt: text("next_follow_up_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_customers_owner_id").on(table.ownerId),
    index("idx_customers_created_at").on(table.createdAt),
    index("idx_customers_phone").on(table.phone),
    index("idx_customers_status").on(table.status),
    index("idx_customers_releaser_user_id").on(table.releaserUserId),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
