import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const MAIL_ADMIN_PERMISSIONS = [
  "super_admin",
  "global_mail_read",
  "account_mgmt",
  "address_assignment",
  "signature_template",
  "auto_reply",
  "audit_view",
  "domain_health",
  "delivery_health",
  "permission_mgmt",
  "approval_review",
] as const;

export type MailAdminPermission = (typeof MAIL_ADMIN_PERMISSIONS)[number];

export const mailAdminGrants = sqliteTable(
  "mail_admin_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    permission: text("permission", { enum: MAIL_ADMIN_PERMISSIONS }).notNull(),
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: text("granted_at").notNull(),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    revokeReason: text("revoke_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_mail_admin_grants_user_id").on(table.userId),
    index("idx_mail_admin_grants_permission").on(table.permission),
    uniqueIndex("uq_mail_admin_grants_user_permission_active")
      .on(table.userId, table.permission)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type MailAdminGrant = typeof mailAdminGrants.$inferSelect;
export type NewMailAdminGrant = typeof mailAdminGrants.$inferInsert;
