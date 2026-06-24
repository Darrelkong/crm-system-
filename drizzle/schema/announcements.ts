import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_AUDIENCES = ["all", "admin", "staff"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status", { enum: ANNOUNCEMENT_STATUSES })
      .notNull()
      .default("draft"),
    audience: text("audience", { enum: ANNOUNCEMENT_AUDIENCES })
      .notNull()
      .default("all"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    publishedAt: text("published_at"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_announcements_status").on(table.status),
    index("idx_announcements_audience").on(table.audience),
    index("idx_announcements_published_at").on(table.publishedAt),
    index("idx_announcements_created_at").on(table.createdAt),
  ],
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
