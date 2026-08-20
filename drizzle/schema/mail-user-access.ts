import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const mailUserAccess = sqliteTable(
  "mail_user_access",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    isEnabled: integer("is_enabled").notNull().default(0),
    enabledAt: text("enabled_at"),
    enabledBy: text("enabled_by").references(() => users.id, {
      onDelete: "set null",
    }),
    disabledAt: text("disabled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_mail_user_access_enabled").on(table.isEnabled)],
);

export type MailUserAccess = typeof mailUserAccess.$inferSelect;
export type NewMailUserAccess = typeof mailUserAccess.$inferInsert;
