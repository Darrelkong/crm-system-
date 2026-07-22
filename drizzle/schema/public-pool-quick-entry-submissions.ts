import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const QUICK_ENTRY_SUBMISSION_STATUSES = [
  "processing",
  "completed",
] as const;
export type QuickEntrySubmissionStatus =
  (typeof QUICK_ENTRY_SUBMISSION_STATUSES)[number];

export const QUICK_ENTRY_SUBMISSION_ROW_STATUSES = [
  "invalid",
  "duplicate",
  "created",
  "failed",
] as const;
export type QuickEntrySubmissionRowStatus =
  (typeof QUICK_ENTRY_SUBMISSION_ROW_STATUSES)[number];

export const QUICK_ENTRY_DUPLICATE_FIELDS = ["phone", "wechatId"] as const;
export type QuickEntryDuplicateField =
  (typeof QUICK_ENTRY_DUPLICATE_FIELDS)[number];

export const publicPoolQuickEntrySubmissions = sqliteTable(
  "public_pool_quick_entry_submissions",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    submissionId: text("submission_id").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: QUICK_ENTRY_SUBMISSION_STATUSES }).notNull(),
    rowCount: integer("row_count").notNull(),
    createdCount: integer("created_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    invalidCount: integer("invalid_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    processingStartedAt: text("processing_started_at").notNull(),
    completedAt: text("completed_at"),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_ppqe_submissions_actor_submission").on(
      table.actorUserId,
      table.submissionId,
    ),
    index("idx_ppqe_submissions_status").on(table.status),
    index("idx_ppqe_submissions_expires_at").on(table.expiresAt),
  ],
);

export const publicPoolQuickEntrySubmissionRows = sqliteTable(
  "public_pool_quick_entry_submission_rows",
  {
    id: text("id").primaryKey(),
    submissionDbId: text("submission_db_id")
      .notNull()
      .references(() => publicPoolQuickEntrySubmissions.id, {
        onDelete: "cascade",
      }),
    clientRowId: text("client_row_id").notNull(),
    rowIndex: integer("row_index").notNull(),
    status: text("status", {
      enum: QUICK_ENTRY_SUBMISSION_ROW_STATUSES,
    }).notNull(),
    errorCode: text("error_code"),
    duplicateField: text("duplicate_field", {
      enum: QUICK_ENTRY_DUPLICATE_FIELDS,
    }),
    customerId: text("customer_id"),
    customerCode: text("customer_code"),
    customerName: text("customer_name"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_ppqe_submission_rows_client_row").on(
      table.submissionDbId,
      table.clientRowId,
    ),
    uniqueIndex("idx_ppqe_submission_rows_row_index").on(
      table.submissionDbId,
      table.rowIndex,
    ),
  ],
);

export type PublicPoolQuickEntrySubmission =
  typeof publicPoolQuickEntrySubmissions.$inferSelect;
export type NewPublicPoolQuickEntrySubmission =
  typeof publicPoolQuickEntrySubmissions.$inferInsert;
export type PublicPoolQuickEntrySubmissionRow =
  typeof publicPoolQuickEntrySubmissionRows.$inferSelect;
export type NewPublicPoolQuickEntrySubmissionRow =
  typeof publicPoolQuickEntrySubmissionRows.$inferInsert;
