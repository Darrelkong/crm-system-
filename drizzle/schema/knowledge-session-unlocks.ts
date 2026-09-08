import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { sessions } from "./sessions";
import { users } from "./users";

export const knowledgeSessionUnlocks = sqliteTable(
  "knowledge_session_unlocks",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    passwordVersionAtUnlock: integer("password_version_at_unlock"),
    unlockedAt: text("unlocked_at"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: text("locked_until"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_knowledge_session_unlocks_user_id").on(table.userId),
    index("idx_knowledge_session_unlocks_locked_until").on(table.lockedUntil),
    check(
      "knowledge_session_unlocks_failed_attempts_range",
      sql`${table.failedAttempts} >= 0 AND ${table.failedAttempts} <= 5`,
    ),
  ],
);

export type KnowledgeSessionUnlock =
  typeof knowledgeSessionUnlocks.$inferSelect;
export type NewKnowledgeSessionUnlock =
  typeof knowledgeSessionUnlocks.$inferInsert;
