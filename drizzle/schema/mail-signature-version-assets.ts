import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mailSignatureVersions } from "./mail-signature-versions";
import { mailStoredFiles } from "./mail-stored-files";

/**
 * Image/file assets used by one admin-managed Signature Version.
 *
 * asset_ref: logical reference in sanitized Signature HTML (e.g. company-logo).
 * NOT an R2 storage key, public URL, signed URL, or download URL.
 *
 * Composite FK (stored_file_id, content_hash) → mail_stored_files.
 * UNIQUE (signature_version_id, asset_ref) per version.
 *
 * asset_refs_json on mail_signature_versions is presentation/editor metadata ONLY.
 * This table is authoritative for physical file provenance.
 *
 * At snapshot creation, version assets are copied to mail_signature_snapshot_assets.
 */
export const mailSignatureVersionAssets = sqliteTable(
  "mail_signature_version_assets",
  {
    id: text("id").primaryKey(),
    signatureVersionId: text("signature_version_id")
      .notNull()
      .references(() => mailSignatureVersions.id),
    storedFileId: text("stored_file_id").notNull(),
    contentHash: text("content_hash").notNull(),
    assetRef: text("asset_ref").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_signature_version_assets_stored_file_hash",
      columns: [table.storedFileId, table.contentHash],
      foreignColumns: [mailStoredFiles.id, mailStoredFiles.contentHash],
    }),
    uniqueIndex("uq_mail_signature_version_assets_version_ref").on(
      table.signatureVersionId,
      table.assetRef,
    ),
    index("idx_mail_signature_version_assets_version_id").on(
      table.signatureVersionId,
    ),
  ],
);

export type MailSignatureVersionAsset =
  typeof mailSignatureVersionAssets.$inferSelect;
export type NewMailSignatureVersionAsset =
  typeof mailSignatureVersionAssets.$inferInsert;
