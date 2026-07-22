import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    lastActivityAt: text("last_activity_at").notNull(),
    revokedAt: text("revoked_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    deviceIdHash: text("device_id_hash"),
    createdAt: text("created_at").notNull(),
    idleExemptUntil: text("idle_exempt_until"),
    idleExemptAttempts: integer("idle_exempt_attempts").notNull().default(0),
    idleExemptLockedUntil: text("idle_exempt_locked_until"),
    /** Public-pool quick-entry short grant expiry (ISO). */
    quickEntryGrantUntil: text("quick_entry_grant_until"),
    /** Settings grant_version captured when grant was issued. */
    quickEntryGrantVersion: integer("quick_entry_grant_version"),
    quickEntryFailedAttempts: integer("quick_entry_failed_attempts")
      .notNull()
      .default(0),
    quickEntryLockedUntil: text("quick_entry_locked_until"),
  },
  (table) => [
    index("idx_sessions_user_id").on(table.userId),
    index("idx_sessions_expires_at").on(table.expiresAt),
    index("idx_sessions_revoked_at").on(table.revokedAt),
    index("idx_sessions_device_id_hash").on(table.deviceIdHash),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
