import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const EXPORT_JOB_STATUSES = ["completed", "failed"] as const;
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

export const EXPORT_JOB_TYPES = ["customers"] as const;
export type ExportJobType = (typeof EXPORT_JOB_TYPES)[number];

export const exportJobs = sqliteTable(
  "export_jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull().$type<ExportJobType>(),
    status: text("status").notNull().$type<ExportJobStatus>(),
    exportedBy: text("exported_by")
      .notNull()
      .references(() => users.id),
    scope: text("scope").notNull(),
    includeSensitive: integer("include_sensitive").notNull().default(1),
    fields: text("fields").notNull(),
    exportedCount: integer("exported_count").notNull().default(0),
    fileName: text("file_name"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_export_jobs_exported_by").on(table.exportedBy),
    index("idx_export_jobs_status").on(table.status),
    index("idx_export_jobs_created_at").on(table.createdAt),
  ],
);

export type ExportJob = typeof exportJobs.$inferSelect;
export type NewExportJob = typeof exportJobs.$inferInsert;
