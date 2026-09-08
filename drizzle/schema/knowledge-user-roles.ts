import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const KNOWLEDGE_ROLES = [
  "viewer",
  "contributor",
  "reviewer",
  "knowledge_admin",
] as const;

export type KnowledgeRole = (typeof KNOWLEDGE_ROLES)[number];

export const knowledgeUserRoles = sqliteTable(
  "knowledge_user_roles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: KNOWLEDGE_ROLES }).notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_knowledge_user_roles_role").on(table.role),
    check(
      "knowledge_user_roles_role_allowed",
      sql`${table.role} IN ('viewer', 'contributor', 'reviewer', 'knowledge_admin')`,
    ),
  ],
);

export type KnowledgeUserRole = typeof knowledgeUserRoles.$inferSelect;
export type NewKnowledgeUserRole = typeof knowledgeUserRoles.$inferInsert;
