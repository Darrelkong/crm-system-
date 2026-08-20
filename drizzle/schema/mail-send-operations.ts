import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { mailOutboundApprovals } from "./mail-outbound-approvals";
import {
  mailOutboundRevisions,
  MAIL_REVISION_KINDS,
} from "./mail-outbound-revisions";

export const MAIL_SEND_AUTHORIZATION_MODES = [
  "staff_approved",
  "admin_direct",
] as const;
export type MailSendAuthorizationMode =
  (typeof MAIL_SEND_AUTHORIZATION_MODES)[number];

export const MAIL_SEND_OPERATION_STATUSES = [
  "pending",
  "processing",
  "accepted",
  "failed",
] as const;
export type MailSendOperationStatus =
  (typeof MAIL_SEND_OPERATION_STATUSES)[number];

/** Staff-approved send revision kinds — NOT admin_direct. */
export const MAIL_SEND_STAFF_APPROVED_REVISION_KINDS = [
  "staff_submit",
  "staff_resubmit",
  "admin_edit",
] as const;

/**
 * Logical outbound send operation — one row per immutable outbound revision.
 *
 * Mutable: status, orchestration_version, next_attempt_at, completed_at.
 * Immutable after create: revision provenance, authorization_mode, approval_id, idempotency_key.
 *
 * orchestration_version: optimistic concurrency for logical-send orchestration (starts at 1).
 * CAS on transitions; stale worker holding old version cannot mutate when status repeats.
 * Belongs ONLY here — NOT on Transport Attempts.
 *
 * Terminal V1: accepted and failed are terminal — service must not revert to pending/processing.
 *
 * Does NOT own delivery state. status=accepted means provider accepted submission,
 * NOT recipient delivery. Approval owns workflow; Transport Attempt owns per-attempt state.
 *
 * Retries = additional mail_transport_attempts under the same Send Operation.
 * At most one started Attempt per Send Operation (partial UNIQUE on Attempts).
 *
 * Future atomic dispatch: CAS pending→processing + create started Attempt in one guarded batch.
 * Post-batch meta.changes is diagnostic only — NOT rollback guarantee.
 *
 * SECURITY-CRITICAL (service layer): staff_approved requires approved Approval + hash recompute;
 * admin_direct requires revision_kind admin_direct + Mail Admin authorization. Not implemented here.
 *
 * No updated_at. No attempt_count. No CASCADE.
 */
export const mailSendOperations = sqliteTable(
  "mail_send_operations",
  {
    id: text("id").primaryKey(),
    outboundRevisionId: text("outbound_revision_id").notNull(),
    revisionChainId: text("revision_chain_id").notNull(),
    contentHash: text("content_hash").notNull(),
    hashVersion: integer("hash_version").notNull(),
    revisionKind: text("revision_kind", { enum: MAIL_REVISION_KINDS }).notNull(),
    authorizationMode: text("authorization_mode", {
      enum: MAIL_SEND_AUTHORIZATION_MODES,
    }).notNull(),
    approvalId: text("approval_id").references(() => mailOutboundApprovals.id),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: MAIL_SEND_OPERATION_STATUSES })
      .notNull()
      .default("pending"),
    orchestrationVersion: integer("orchestration_version").notNull().default(1),
    initiatedByUserId: text("initiated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    nextAttemptAt: text("next_attempt_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_send_operations_revision_chain_hash_kind",
      columns: [
        table.outboundRevisionId,
        table.revisionChainId,
        table.contentHash,
        table.hashVersion,
        table.revisionKind,
      ],
      foreignColumns: [
        mailOutboundRevisions.id,
        mailOutboundRevisions.revisionChainId,
        mailOutboundRevisions.contentHash,
        mailOutboundRevisions.hashVersion,
        mailOutboundRevisions.revisionKind,
      ],
    }),
    foreignKey({
      name: "fk_mail_send_operations_approval_approved_tuple",
      columns: [
        table.approvalId,
        table.outboundRevisionId,
        table.contentHash,
        table.hashVersion,
      ],
      foreignColumns: [
        mailOutboundApprovals.id,
        mailOutboundApprovals.approvedRevisionId,
        mailOutboundApprovals.approvedContentHash,
        mailOutboundApprovals.approvedHashVersion,
      ],
    }),
    uniqueIndex("uq_mail_send_operations_outbound_revision_id").on(
      table.outboundRevisionId,
    ),
    uniqueIndex("uq_mail_send_operations_idempotency_key").on(
      table.idempotencyKey,
    ),
    index("idx_mail_send_operations_status_next_attempt_at").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("idx_mail_send_operations_approval_id").on(table.approvalId),
    index("idx_mail_send_operations_initiated_by_user_id").on(
      table.initiatedByUserId,
    ),
    index("idx_mail_send_operations_revision_chain_id").on(
      table.revisionChainId,
    ),
    uniqueIndex("uq_mail_send_operations_id_outbound_revision_id").on(
      table.id,
      table.outboundRevisionId,
    ),
  ],
);

export type MailSendOperation = typeof mailSendOperations.$inferSelect;
export type NewMailSendOperation = typeof mailSendOperations.$inferInsert;
