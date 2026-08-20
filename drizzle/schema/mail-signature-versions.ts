import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { mailSenderIdentities } from "./mail-sender-identities";

/**
 * Versioned admin-managed signature per Sender Identity.
 *
 * Signature belongs to Sender Identity — NOT CRM user, NOT mailbox.
 * Append-only versions; one active version per identity (partial unique).
 *
 * body_html_sanitized: canonical sanitized admin HTML only.
 * asset_refs_json: presentation/editor metadata ONLY — NOT authoritative for physical
 * file identity, content hash, storage key, or asset existence. Authoritative mapping:
 * mail_signature_version_assets (0055). No public/storage URLs in asset_refs_json.
 *
 * Lifecycle CHECK (SQL): is_active=1 requires retired_at NULL; retired_at set requires is_active=0.
 * Inactive without retired_at is allowed.
 */
export const mailSignatureVersions = sqliteTable(
  "mail_signature_versions",
  {
    id: text("id").primaryKey(),
    senderIdentityId: text("sender_identity_id")
      .notNull()
      .references(() => mailSenderIdentities.id),
    versionNumber: integer("version_number").notNull(),
    bodyText: text("body_text").notNull().default(""),
    bodyHtmlSanitized: text("body_html_sanitized"),
    assetRefsJson: text("asset_refs_json"),
    isActive: integer("is_active").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    retiredAt: text("retired_at"),
    retiredByUserId: text("retired_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_mail_signature_versions_sender_identity").on(
      table.senderIdentityId,
    ),
    uniqueIndex("uq_mail_signature_versions_sender_version").on(
      table.senderIdentityId,
      table.versionNumber,
    ),
    uniqueIndex("uq_mail_signature_versions_id_identity").on(
      table.id,
      table.senderIdentityId,
    ),
    uniqueIndex("uq_mail_signature_versions_active_per_identity")
      .on(table.senderIdentityId)
      .where(sql`${table.isActive} = 1`),
  ],
);

export type MailSignatureVersion = typeof mailSignatureVersions.$inferSelect;
export type NewMailSignatureVersion = typeof mailSignatureVersions.$inferInsert;
