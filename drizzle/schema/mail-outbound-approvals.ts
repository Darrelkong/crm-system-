import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { mailOutboundRevisions } from "./mail-outbound-revisions";

export const MAIL_OUTBOUND_APPROVAL_STATUSES = [
  "pending",
  "returned",
  "withdrawn",
  "approved",
] as const;
export type MailOutboundApprovalStatus =
  (typeof MAIL_OUTBOUND_APPROVAL_STATUSES)[number];

export const MAIL_OUTBOUND_APPROVAL_PRIORITIES = ["normal", "urgent"] as const;
export type MailOutboundApprovalPriority =
  (typeof MAIL_OUTBOUND_APPROVAL_PRIORITIES)[number];

/** Event types that require revision provenance on the event row. */
export const MAIL_OUTBOUND_APPROVAL_REVISION_REQUIRED_EVENT_TYPES = [
  "submitted",
  "resubmitted",
  "returned",
  "withdrawn",
  "approved",
  "admin_edit",
] as const;

/**
 * Staff outbound Mail approval workflow — one row per revision_chain_id.
 *
 * Mutable workflow state; immutable revisions and append-only events preserve history.
 * Does NOT own send/transport/delivery state.
 *
 * Admin direct revisions (revision_kind = admin_direct) do NOT require a row here.
 *
 * SECURITY-CRITICAL (service layer): before bind, recompute FROZEN Canonical Content Hash v1
 * and verify against revision.content_hash + hash_version. Do NOT trust stored hash blindly.
 *
 * When status = approved, approved_* MUST equal current_* exactly.
 *
 * workflow_version: increments ONLY on non-reminder workflow transitions (each creates exactly
 * one transition event at the new version). Does NOT increment for priority-only or
 * next_reminder_at scheduler changes. Optimistic concurrency CAS on transitions.
 *
 * D1 batch: CAS UPDATE + GUARDED transition Event INSERT in env.DB.batch (one transaction).
 * Guarded INSERT derives approval_id from scalar subquery on exact POST-transition Approval state;
 * NULL subquery → NOT NULL failure → batch rollback. Post-batch meta.changes is diagnostic only.
 *
 * next_reminder_at valid only while status = pending.
 *
 * resolved_at IS NULL only while pending. returned/withdrawn/approved require resolved_at.
 * resolved_by_user_id MAY be NULL after user deletion (ON DELETE SET NULL).
 *
 * requested_by_user_id: RESTRICT — requester cannot be hard-deleted while history exists.
 *
 * Workflow mutation + Approval Event must be written atomically (env.DB.batch).
 *
 * No updated_at. No CASCADE.
 */
export const mailOutboundApprovals = sqliteTable(
  "mail_outbound_approvals",
  {
    id: text("id").primaryKey(),
    revisionChainId: text("revision_chain_id").notNull(),
    status: text("status", { enum: MAIL_OUTBOUND_APPROVAL_STATUSES }).notNull(),
    priority: text("priority", { enum: MAIL_OUTBOUND_APPROVAL_PRIORITIES })
      .notNull()
      .default("normal"),
    workflowVersion: integer("workflow_version").notNull().default(1),
    currentRevisionId: text("current_revision_id").notNull(),
    currentContentHash: text("current_content_hash").notNull(),
    currentHashVersion: integer("current_hash_version").notNull(),
    approvedRevisionId: text("approved_revision_id"),
    approvedContentHash: text("approved_content_hash"),
    approvedHashVersion: integer("approved_hash_version"),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id),
    requestedAt: text("requested_at").notNull(),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: text("resolved_at"),
    nextReminderAt: text("next_reminder_at"),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_outbound_approvals_current_revision_chain_hash",
      columns: [
        table.currentRevisionId,
        table.revisionChainId,
        table.currentContentHash,
        table.currentHashVersion,
      ],
      foreignColumns: [
        mailOutboundRevisions.id,
        mailOutboundRevisions.revisionChainId,
        mailOutboundRevisions.contentHash,
        mailOutboundRevisions.hashVersion,
      ],
    }),
    foreignKey({
      name: "fk_mail_outbound_approvals_approved_revision_chain_hash",
      columns: [
        table.approvedRevisionId,
        table.revisionChainId,
        table.approvedContentHash,
        table.approvedHashVersion,
      ],
      foreignColumns: [
        mailOutboundRevisions.id,
        mailOutboundRevisions.revisionChainId,
        mailOutboundRevisions.contentHash,
        mailOutboundRevisions.hashVersion,
      ],
    }),
    uniqueIndex("uq_mail_outbound_approvals_revision_chain_id").on(
      table.revisionChainId,
    ),
    uniqueIndex("uq_mail_outbound_approvals_id_revision_chain_id").on(
      table.id,
      table.revisionChainId,
    ),
    index("idx_mail_outbound_approvals_status_requested_at").on(
      table.status,
      table.requestedAt,
    ),
    index("idx_mail_outbound_approvals_current_revision_id").on(
      table.currentRevisionId,
    ),
    index("idx_mail_outbound_approvals_approved_revision_id").on(
      table.approvedRevisionId,
    ),
    index("idx_mail_outbound_approvals_next_reminder_at").on(
      table.nextReminderAt,
    ),
  ],
);

export type MailOutboundApproval = typeof mailOutboundApprovals.$inferSelect;
export type NewMailOutboundApproval = typeof mailOutboundApprovals.$inferInsert;
