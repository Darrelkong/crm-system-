import { sql } from "drizzle-orm";
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
import {
  mailOutboundApprovals,
  MAIL_OUTBOUND_APPROVAL_REVISION_REQUIRED_EVENT_TYPES,
} from "./mail-outbound-approvals";

/** State-transition events — at most one per (approval_id, workflow_version). */
export const MAIL_OUTBOUND_APPROVAL_STATE_TRANSITION_EVENT_TYPES = [
  ...MAIL_OUTBOUND_APPROVAL_REVISION_REQUIRED_EVENT_TYPES,
] as const;
export type MailOutboundApprovalStateTransitionEventType =
  (typeof MAIL_OUTBOUND_APPROVAL_STATE_TRANSITION_EVENT_TYPES)[number];

export const MAIL_OUTBOUND_APPROVAL_EVENT_TYPES = [
  ...MAIL_OUTBOUND_APPROVAL_STATE_TRANSITION_EVENT_TYPES,
  "reminder_sent",
] as const;
export type MailOutboundApprovalEventType =
  (typeof MAIL_OUTBOUND_APPROVAL_EVENT_TYPES)[number];

/**
 * Append-only Staff Mail approval workflow events.
 *
 * revision_chain_id required — event chain must match approval chain (composite FK).
 * Revision provenance uses chain composite FK to mail_outbound_revisions.
 *
 * workflow_version: immutable snapshot of Approval workflow version at event time.
 * Do NOT FK event.workflow_version → approval.workflow_version (approval version mutates).
 *
 * State-transition events: partial UNIQUE (approval_id, workflow_version) excludes reminder_sent.
 * reminder_sent may repeat for same approval_id + workflow_version; does not increment Approval version.
 *
 * submitted/resubmitted/returned/withdrawn/approved/admin_edit require revision provenance.
 * reminder_sent may omit revision provenance.
 *
 * workflow_version: immutable snapshot at event time. Equals approval.workflow_version after a
 * committed transition. reminder_sent records current version without incrementing Approval.
 *
 * D1 batch: GUARDED transition INSERT — approval_id from POST-transition Approval subquery.
 * Partial UNIQUE is second defense-in-depth. Post-batch meta.changes is diagnostic only.
 * reminder_sent: no guarded transition CAS; records current version without incrementing Approval.
 *
 * No updated_at. No CASCADE. No transport/delivery events.
 */
export const mailOutboundApprovalEvents = sqliteTable(
  "mail_outbound_approval_events",
  {
    id: text("id").primaryKey(),
    approvalId: text("approval_id").notNull(),
    revisionChainId: text("revision_chain_id").notNull(),
    eventType: text("event_type", {
      enum: MAIL_OUTBOUND_APPROVAL_EVENT_TYPES,
    }).notNull(),
    workflowVersion: integer("workflow_version").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revisionId: text("revision_id"),
    contentHash: text("content_hash"),
    hashVersion: integer("hash_version"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "fk_mail_outbound_approval_events_approval_chain",
      columns: [table.approvalId, table.revisionChainId],
      foreignColumns: [
        mailOutboundApprovals.id,
        mailOutboundApprovals.revisionChainId,
      ],
    }),
    foreignKey({
      name: "fk_mail_outbound_approval_events_revision_chain_hash",
      columns: [
        table.revisionId,
        table.revisionChainId,
        table.contentHash,
        table.hashVersion,
      ],
      foreignColumns: [
        mailOutboundRevisions.id,
        mailOutboundRevisions.revisionChainId,
        mailOutboundRevisions.contentHash,
        mailOutboundRevisions.hashVersion,
      ],
    }),
    uniqueIndex("uq_mail_outbound_approval_events_transition_per_version")
      .on(table.approvalId, table.workflowVersion)
      .where(sql`${table.eventType} != 'reminder_sent'`),
    index("idx_mail_outbound_approval_events_approval_created").on(
      table.approvalId,
      table.createdAt,
    ),
    index("idx_mail_outbound_approval_events_actor_user_id").on(
      table.actorUserId,
    ),
    index("idx_mail_outbound_approval_events_revision_id").on(table.revisionId),
  ],
);

export type MailOutboundApprovalEvent =
  typeof mailOutboundApprovalEvents.$inferSelect;
export type NewMailOutboundApprovalEvent =
  typeof mailOutboundApprovalEvents.$inferInsert;
