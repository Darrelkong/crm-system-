import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const MAIL_STORAGE_PROVIDERS = ["r2"] as const;
export type MailStorageProvider = (typeof MAIL_STORAGE_PROVIDERS)[number];

export const MAIL_SECURITY_SCAN_STATUSES = [
  "unscanned",
  "clean",
  "blocked",
  "scan_failed",
] as const;
export type MailSecurityScanStatus = (typeof MAIL_SECURITY_SCAN_STATUSES)[number];

/**
 * Immutable physical file/blob identity — separate from attachment usage rows.
 *
 * content_hash: SHA-256 lowercase hex (64 chars) of stored FILE BYTES. NOT globally unique.
 * CHECK enforces length=64 and lowercase hex only. Identical bytes may exist in multiple rows.
 *
 * security_scan_status: operational metadata — NOT file bytes, NOT hash input.
 * Lifecycle (SQL): unscanned → scanned_at NULL; clean/blocked/scan_failed → scanned_at NOT NULL.
 *
 * Message-specific fields (display_filename, delivery_mode) belong on usage rows.
 *
 * UNIQUE (id, content_hash) supports composite FK provenance on revision/message attachments.
 */
export const mailStoredFiles = sqliteTable(
  "mail_stored_files",
  {
    id: text("id").primaryKey(),
    contentHash: text("content_hash").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageProvider: text("storage_provider", {
      enum: MAIL_STORAGE_PROVIDERS,
    }).notNull(),
    storageBucket: text("storage_bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    securityScanStatus: text("security_scan_status", {
      enum: MAIL_SECURITY_SCAN_STATUSES,
    })
      .notNull()
      .default("unscanned"),
    securityScannedAt: text("security_scanned_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_mail_stored_files_id_content_hash").on(
      table.id,
      table.contentHash,
    ),
    index("idx_mail_stored_files_content_hash").on(table.contentHash),
    uniqueIndex("uq_mail_stored_files_storage_key").on(table.storageKey),
    index("idx_mail_stored_files_created_by").on(table.createdByUserId),
  ],
);

export type MailStoredFile = typeof mailStoredFiles.$inferSelect;
export type NewMailStoredFile = typeof mailStoredFiles.$inferInsert;
