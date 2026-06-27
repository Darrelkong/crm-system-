import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const loginIpEmailRestrictions = sqliteTable(
  "login_ip_email_restrictions",
  {
    ipAddress: text("ip_address").primaryKey(),
    failedEmailAttempts: integer("failed_email_attempts").notNull().default(0),
    penaltyLevel: integer("penalty_level").notNull().default(0),
    restrictedUntil: text("restricted_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_login_ip_email_restrictions_restricted_until").on(
      table.restrictedUntil,
    ),
  ],
);

export type LoginIpEmailRestriction =
  typeof loginIpEmailRestrictions.$inferSelect;
export type NewLoginIpEmailRestriction =
  typeof loginIpEmailRestrictions.$inferInsert;
