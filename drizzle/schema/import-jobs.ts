import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const IMPORT_JOB_STATUSES = [
  "prechecked",
  "completed",
  "failed",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const IMPORT_JOB_TYPES = ["customers"] as const;
export type ImportJobType = (typeof IMPORT_JOB_TYPES)[number];

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull().$type<ImportJobType>(),
    status: text("status").notNull().$type<ImportJobStatus>(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    fileName: text("file_name"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    errorSummary: text("error_summary"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_import_jobs_uploaded_by").on(table.uploadedBy),
    index("idx_import_jobs_status").on(table.status),
    index("idx_import_jobs_created_at").on(table.createdAt),
  ],
);

export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
