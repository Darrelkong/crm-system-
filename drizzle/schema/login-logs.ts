import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const loginLogs = sqliteTable(
  "login_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    emailAttempted: text("email_attempted").notNull(),
    success: integer("success").notNull(),
    failureReason: text("failure_reason"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_login_logs_email").on(table.emailAttempted),
    index("idx_login_logs_created_at").on(table.createdAt),
  ],
);

export type LoginLog = typeof loginLogs.$inferSelect;
export type NewLoginLog = typeof loginLogs.$inferInsert;
