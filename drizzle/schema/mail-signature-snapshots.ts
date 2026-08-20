import {
  foreignKey,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { mailSenderIdentities } from "./mail-sender-identities";
import { mailSignatureVersions } from "./mail-signature-versions";

/**
 * Immutable signature content captured for one outbound revision.
 *
 * One revision owns one dedicated snapshot row (not reused across revisions).
 * snapshot_hash is NOT globally unique — identical content may appear in multiple rows.
 *
 * Composite FK (source_signature_version_id, sender_identity_id) ensures source version
 * belongs to the same Sender Identity when present. NULL source version is allowed.
 *
 * UNIQUE (id, sender_identity_id) supports revision composite FK lineage enforcement.
 *
 * asset_refs_json: presentation/editor metadata ONLY — NOT authoritative for physical
 * file identity, content hash, storage key, or asset existence. Authoritative mapping:
 * mail_signature_snapshot_assets (0055). No public/storage URLs in asset_refs_json.
 *
 * Created before revision content hash. No updated_at.
 * Survives later signature version changes — revisions keep their snapshot.
 */
export const mailSignatureSnapshots = sqliteTable(
  "mail_signature_snapshots",
  {
    id: text("id").primaryKey(),
    senderIdentityId: text("sender_identity_id")
      .notNull()
      .references(() => mailSenderIdentities.id),
    sourceSignatureVersionId: text("source_signature_version_id"),
    bodyText: text("body_text").notNull().default(""),
    bodyHtmlSanitized: text("body_html_sanitized"),
    assetRefsJson: text("asset_refs_json"),
    snapshotHash: text("snapshot_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_mail_signature_snapshots_id_identity").on(
      table.id,
      table.senderIdentityId,
    ),
    foreignKey({
      name: "fk_mail_signature_snapshots_source_version_identity",
      columns: [table.sourceSignatureVersionId, table.senderIdentityId],
      foreignColumns: [
        mailSignatureVersions.id,
        mailSignatureVersions.senderIdentityId,
      ],
    }),
    index("idx_mail_signature_snapshots_sender_identity").on(
      table.senderIdentityId,
    ),
    index("idx_mail_signature_snapshots_source_version").on(
      table.sourceSignatureVersionId,
    ),
  ],
);

export type MailSignatureSnapshot = typeof mailSignatureSnapshots.$inferSelect;
export type NewMailSignatureSnapshot = typeof mailSignatureSnapshots.$inferInsert;
