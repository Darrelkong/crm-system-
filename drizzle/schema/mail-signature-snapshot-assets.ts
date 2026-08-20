import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { mailSignatureSnapshots } from "./mail-signature-snapshots";
import { mailStoredFiles } from "./mail-stored-files";

/**
 * Immutable image/file assets frozen into one Signature Snapshot.
 *
 * Materialized at snapshot creation — do NOT read live mail_signature_version_assets
 * at Approval or Send time after snapshot exists.
 *
 * asset_ref: logical HTML reference frozen at snapshot time.
 * No updated_at. No public URL.
 *
 * Future canonical hash inputs (documented; NOT frozen):
 *   asset_ref, content_hash, mime_type, size_bytes, deterministic sort_order
 * EXCLUDED: stored_file_id, storage keys, database row IDs.
 */
export const mailSignatureSnapshotAssets = sqliteTable(
  "mail_signature_snapshot_assets",
  {
    id: text("id").primaryKey(),
    signatureSnapshotId: text("signature_snapshot_id")
      .notNull()
      .references(() => mailSignatureSnapshots.id),
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
      name: "fk_mail_signature_snapshot_assets_stored_file_hash",
      columns: [table.storedFileId, table.contentHash],
      foreignColumns: [mailStoredFiles.id, mailStoredFiles.contentHash],
    }),
    uniqueIndex("uq_mail_signature_snapshot_assets_snapshot_ref").on(
      table.signatureSnapshotId,
      table.assetRef,
    ),
    index("idx_mail_signature_snapshot_assets_snapshot_id").on(
      table.signatureSnapshotId,
    ),
  ],
);

export type MailSignatureSnapshotAsset =
  typeof mailSignatureSnapshotAssets.$inferSelect;
export type NewMailSignatureSnapshotAsset =
  typeof mailSignatureSnapshotAssets.$inferInsert;
