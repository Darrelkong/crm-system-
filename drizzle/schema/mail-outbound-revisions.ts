import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { customers } from "./customers";
import { mailMailboxes } from "./mail-mailboxes";
import { mailSenderIdentities } from "./mail-sender-identities";
import { mailMessages } from "./mail-messages";
import { mailDrafts, MAIL_CUSTOMER_ASSOCIATION_TYPES } from "./mail-drafts";
import { mailSignatureSnapshots } from "./mail-signature-snapshots";
import {
  MAIL_COMPOSE_MODES,
  MAIL_MESSAGE_SENSITIVITIES,
} from "./mail-messages";

export const MAIL_REVISION_KINDS = [
  "staff_submit",
  "staff_resubmit",
  "admin_edit",
  "admin_direct",
] as const;
export type MailRevisionKind = (typeof MAIL_REVISION_KINDS)[number];

/**
 * Immutable generic outbound content — NOT approval-specific.
 *
 * Append-only by domain rule. No updated_at. No approval/send/delivery state.
 * Approval table later points current_revision_id / approved_revision_id here.
 *
 * Revision chain: revision_chain_id + revision_number (unique).
 * First revision: number=1, parent_revision_id=NULL; number>1 requires parent NOT NULL.
 * Cross-chain parent match is service-layer enforced.
 *
 * One revision owns one signature snapshot (signature_snapshot_id unique per revision).
 * Composite FK (signature_snapshot_id, sender_identity_id) enforces snapshot lineage.
 *
 * from_address / from_display_name are historical From snapshots — do not render
 * from mutable live identity display name.
 *
 * SECURITY-CRITICAL (service layer): at revision creation, resolved Sender Identity
 * address MUST equal from_address being snapshotted. No live DB FK to
 * mail_sender_identities.address — historical snapshot must not couple to mutable metadata.
 *
 * body_html_sanitized only — created by server after sanitization.
 *
 * content_hash / hash_version: Canonical Content Hash v1 (ECHFRONT-MAIL-CONTENT-V1).
 * CRM customer association is NOT hash input. Attachments and signature snapshot content included.
 *
 * Customer association CHECK (SQL): when customer_id is set, type + associated_at required;
 * customer_association_type IS NOT NULL explicit (NULL IN (...) is not a rejection in SQLite).
 * customer_associated_by_user_id MAY be NULL (ON DELETE SET NULL or system auto-match).
 *
 * Recipient minimum at submit: >=1 unique address across To+Cc+Bcc (NOT To-specific).
 * Max 50 unique recipients: service layer only.
 */
export const mailOutboundRevisions = sqliteTable(
  "mail_outbound_revisions",
  {
    id: text("id").primaryKey(),
    revisionChainId: text("revision_chain_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    parentRevisionId: text("parent_revision_id").references(
      (): AnySQLiteColumn => mailOutboundRevisions.id,
    ),
    sourceDraftId: text("source_draft_id").references(() => mailDrafts.id),
    revisionKind: text("revision_kind", { enum: MAIL_REVISION_KINDS }).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailMailboxes.id),
    senderIdentityId: text("sender_identity_id")
      .notNull()
      .references(() => mailSenderIdentities.id),
    fromAddress: text("from_address").notNull(),
    fromDisplayName: text("from_display_name"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull().default(""),
    bodyHtmlSanitized: text("body_html_sanitized"),
    sensitivity: text("sensitivity", { enum: MAIL_MESSAGE_SENSITIVITIES })
      .notNull()
      .default("normal"),
    composeMode: text("compose_mode", { enum: MAIL_COMPOSE_MODES }).notNull(),
    replyToMessageId: text("reply_to_message_id").references(
      () => mailMessages.id,
    ),
    signatureSnapshotId: text("signature_snapshot_id").notNull(),
    customerId: text("customer_id").references(() => customers.id),
    customerAssociationType: text("customer_association_type", {
      enum: MAIL_CUSTOMER_ASSOCIATION_TYPES,
    }),
    customerAssociatedByUserId: text("customer_associated_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    customerAssociatedAt: text("customer_associated_at"),
    contentHash: text("content_hash").notNull(),
    hashVersion: integer("hash_version").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_outbound_revisions_signature_snapshot_identity",
      columns: [table.signatureSnapshotId, table.senderIdentityId],
      foreignColumns: [
        mailSignatureSnapshots.id,
        mailSignatureSnapshots.senderIdentityId,
      ],
    }),
    uniqueIndex("uq_mail_outbound_revisions_chain_number").on(
      table.revisionChainId,
      table.revisionNumber,
    ),
    uniqueIndex("uq_mail_outbound_revisions_signature_snapshot").on(
      table.signatureSnapshotId,
    ),
    index("idx_mail_outbound_revisions_source_draft").on(table.sourceDraftId),
    index("idx_mail_outbound_revisions_created_by").on(table.createdByUserId),
    index("idx_mail_outbound_revisions_customer_id").on(table.customerId),
    uniqueIndex("uq_mail_outbound_revisions_id_content_hash_version").on(
      table.id,
      table.contentHash,
      table.hashVersion,
    ),
    uniqueIndex("uq_mail_outbound_revisions_id_chain_hash_version").on(
      table.id,
      table.revisionChainId,
      table.contentHash,
      table.hashVersion,
    ),
  ],
);

export type MailOutboundRevision = typeof mailOutboundRevisions.$inferSelect;
export type NewMailOutboundRevision = typeof mailOutboundRevisions.$inferInsert;
