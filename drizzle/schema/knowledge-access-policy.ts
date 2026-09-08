import { integer, sqliteTable, text, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const knowledgeAccessPolicy = sqliteTable(
  "knowledge_access_policy",
  {
    id: text("id").primaryKey(),
    passwordHash: text("password_hash").notNull(),
    passwordVersion: integer("password_version").notNull().default(1),
    initializedBy: text("initialized_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "knowledge_access_policy_singleton_id",
      sql`${table.id} = 'singleton'`,
    ),
    check(
      "knowledge_access_policy_password_version_positive",
      sql`${table.passwordVersion} >= 1`,
    ),
  ],
);

export type KnowledgeAccessPolicy = typeof knowledgeAccessPolicy.$inferSelect;
export type NewKnowledgeAccessPolicy =
  typeof knowledgeAccessPolicy.$inferInsert;
