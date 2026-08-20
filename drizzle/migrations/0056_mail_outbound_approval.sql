-- Phase 2B.10: Staff outbound Mail approval workflow schema
-- Phase 2B.10.1: Pre-apply workflow integrity hardening (same migration — NOT applied yet)
-- Phase 2B.10.2: Approval event workflow_version + transition uniqueness (same migration)
-- Phase 2B.10.3: D1 CAS + Approval event atomicity contract correction (comments only)
-- Phase 2B.10.4: D1 guarded transition Event atomicity contract (comments only)
-- ADDITIVE ONLY. No seed data. Depends on 0052–0055.
--
-- Rollback policy: do NOT drop these tables as a normal rollback.
-- Approval workflow history is correspondence/audit history.
--
-- Product rule: ordinary Staff outbound Mail requires Admin approval (new/reply/reply_all/forward).
-- Admin direct send (revision_kind = admin_direct) does NOT create a fake Staff Approval row.
--
-- Approval owns WORKFLOW STATE only — NOT send state, transport state, or delivery state.
-- "Approve & Send" is two domain effects: (A) Approval approve revision/hash, (B) future Send Operation.
--
-- SECURITY-CRITICAL (service layer — NOT implemented here):
--   Before binding a revision into Approval, the service MUST:
--     1. Load immutable revision + recipients + signature snapshot/assets + attachments
--     2. Recompute Canonical Content Hash using FROZEN v1 contract (ECHFRONT-MAIL-CONTENT-V1)
--     3. Compare recomputed hash to revision.content_hash and revision.hash_version
--     4. Reject on mismatch — do NOT trust persisted content_hash blindly
--
-- Approval invalidation: any approval-relevant content change requires NEW Outbound Revision +
-- NEW Canonical Content Hash. Old revisions are never mutated.
--
-- CRM customer association is NOT Canonical Hash v1 input, but association is frozen per Revision.
-- Changing submitted association still requires a NEW Revision for audit/history (service layer).
--
-- Revision chain consistency: composite FK (current_revision_id, revision_chain_id,
-- current_content_hash, current_hash_version) enforces defense-in-depth at DB layer.
-- Service layer MUST still validate chain membership.
--
-- Final approval semantics (2B.10.1): when status = approved, approved_* MUST equal current_* exactly.
-- Admin approves the revision/hash currently under review — not a different revision in the chain.
--
-- workflow_version semantics (2B.10.1–2B.10.4):
--   workflow_version changes ONLY when a workflow transition creates exactly ONE non-reminder
--   immutable Approval Event (submitted, returned, withdrawn, resubmitted, admin_edit, approved).
--   Each workflow_version value has AT MOST ONE transition event (partial UNIQUE) and the
--   service contract guarantees EXACTLY ONE per successfully committed transition.
--   workflow_version does NOT change for: reminder_sent, priority-only changes, next_reminder_at
--   scheduler metadata updates. No priority_changed event in V1.
--
-- Optimistic concurrency (2B.10.1): future service CAS on transitions:
--   UPDATE ... SET workflow_version = N + 1, ... WHERE id = ? AND workflow_version = N AND ...
--   Prevents two Admins from making stale conflicting decisions on transitions.
--
-- Reminder coupling (2B.10.1): next_reminder_at valid only while status = pending.
-- Returned / withdrawn / approved workflows must not remain reminder-eligible.
-- Changing next_reminder_at does NOT increment workflow_version (scheduler metadata).
--
-- D1 batch atomicity + guarded CAS contract (2B.10.3–2B.10.4 — service layer, NOT implemented):
--   Cloudflare D1 env.DB.batch([...]) executes statements sequentially in ONE SQL transaction.
--   Do NOT assume D1Database.transaction() exists. Use env.DB.batch([...]) only.
--
--   LOCKED V1 transition pattern (N → N+1) batch contains BOTH:
--     A) CAS UPDATE mail_outbound_approvals
--          SET status/current revision/hash/workflow_version = post-transition values
--          WHERE id = approval_id AND workflow_version = N
--            AND status / current_revision_id / current_content_hash / current_hash_version
--            match expected pre-transition state
--     B) GUARDED transition Event INSERT — NOT a free-standing INSERT after CAS
--
--   Guarded Event INSERT (required atomic safety property):
--     Derive at least one REQUIRED NOT NULL column (e.g. approval_id) from a scalar subquery
--     against the exact intended POST-transition Approval row:
--       SELECT id FROM mail_outbound_approvals
--       WHERE id = :approval_id AND workflow_version = :new_version
--         AND status = :new_status
--         AND current_revision_id = :new_revision_id
--         AND current_content_hash = :new_content_hash
--         AND current_hash_version = :new_hash_version
--     If CAS did not transition Approval, subquery returns NULL → approval_id NULL
--     → NOT NULL constraint failure → statement fails → D1 batch rolls back.
--     Exact production SQL may be refined; this safety property is LOCKED.
--
--   Approved transition: guarded post-state must include status = approved. DB CHECK already
--   guarantees approved_* = current_* when approved; guarded query may also include approved_*.
--   Same guarded principle for: returned, withdrawn, resubmitted, admin_edit, approved.
--
--   IMPORTANT — zero-row CAS is NOT automatic batch control flow:
--     A zero-row UPDATE is NOT a SQL statement failure. D1 batch does NOT inherently skip later
--     statements merely because CAS updated zero rows.
--
--   POST-BATCH RESULT INSPECTION (meta.changes, D1Result):
--     diagnostic / conflict detection ONLY — NOT the atomic rollback guarantee.
--     The batch has already executed when results return; inspecting changes=0 cannot retroactively
--     rollback an already-successful guarded INSERT. Atomic rollback MUST come from transactional
--     SQL statement failure / constraints (guarded INSERT NOT NULL failure, FK, partial UNIQUE).
--
--   Partial UNIQUE (approval_id, workflow_version) WHERE event_type != 'reminder_sent':
--     SECOND defense-in-depth — e.g. stale competing transition cannot also claim N+1 if already
--     committed. Do NOT describe this UNIQUE as the only stale-CAS protection.
--
--   Transition version invariant (committed success):
--     approval.workflow_version AFTER transition == transition_event.workflow_version
--     Examples: submitted Approval v1 + Event v1; returned v2 + Event v2; approved v5 + Event v5.
--
--   Initial submission atomic create (special case):
--     INSERT Approval workflow_version = 1, status = pending, current revision/hash/version
--     AND INSERT submitted Event workflow_version = 1 in the same atomic batch.
--     Event FK provenance to newly created Approval; Approval INSERT failure prevents valid Event.
--     There must never be a committed Approval v1 without its submitted Event.
--
-- Event workflow_version (2B.10.2): immutable historical snapshot at event time.
-- Do NOT FK event.workflow_version → approval.workflow_version (approval version mutates).
--
-- Reminder contract (2B.10.2–2B.10.4): reminder_sent does NOT increment Approval workflow_version.
-- Reminder writes do NOT use transition CAS/guarded pattern or transition partial UNIQUE.
-- Reminder event records CURRENT workflow_version; multiple reminder_sent per same version allowed.
-- priority / next_reminder_at changes do NOT increment workflow_version (not transition events).
--
-- requested_by_user_id uses RESTRICT (no ON DELETE SET NULL). A referenced requester cannot be
-- hard-deleted while Approval history exists. Acceptable when CRM users follow soft-delete /
-- deactivation lifecycle. Do not silently change user lifecycle policy.
--
-- Future atomic writes: use env.DB.batch([...]) — not D1Database.transaction().

-- ---------------------------------------------------------------------------
-- Revision provenance candidate keys (added here — 0054 NOT edited)
--
-- Enables composite FKs from Approval and Approval Events to revision id + hash tuple.
-- Chain composite additionally binds revision_chain_id for workflow consistency.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_content_hash_version
  ON mail_outbound_revisions (id, content_hash, hash_version);

CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_chain_hash_version
  ON mail_outbound_revisions (id, revision_chain_id, content_hash, hash_version);

-- ---------------------------------------------------------------------------
-- mail_outbound_approvals — Staff approval workflow per revision chain
--
-- One row per revision_chain_id (UNIQUE). Returned/withdrawn workflows may be resubmitted
-- with a NEW immutable revision in the same chain; this row holds mutable workflow state.
-- Historical transitions are append-only in mail_outbound_approval_events.
--
-- current_revision_* always required — Approval never represents a blank Draft.
-- Draft → Revision first, then Revision → Approval.
--
-- approved_revision_* required only when status = approved; NULL otherwise.
-- When approved: approved_* MUST equal current_* exactly (final approval semantics).
--
-- workflow_version: optimistic concurrency counter (starts at 1).
--
-- resolved_at / resolved_by_user_id semantics:
--   pending  -> resolved_at IS NULL AND resolved_by_user_id IS NULL
--   returned / withdrawn / approved -> resolved_at IS NOT NULL
--   resolved_by_user_id MAY be NULL after user deletion (ON DELETE SET NULL)
--
-- next_reminder_at: only valid while status = pending (CHECK enforced).
--
-- Urgent priority never bypasses approval — no bypass_approval / auto_approve.
--
-- No updated_at. No send/delivery/transport state columns.
-- No CASCADE deletes — history survives user/mailbox lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  revision_chain_id TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  workflow_version INTEGER NOT NULL DEFAULT 1,
  current_revision_id TEXT NOT NULL,
  current_content_hash TEXT NOT NULL,
  current_hash_version INTEGER NOT NULL,
  approved_revision_id TEXT,
  approved_content_hash TEXT,
  approved_hash_version INTEGER,
  requested_by_user_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  resolved_by_user_id TEXT,
  resolved_at TEXT,
  next_reminder_at TEXT,
  FOREIGN KEY (requested_by_user_id) REFERENCES users (id),
  FOREIGN KEY (resolved_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (
    current_revision_id,
    revision_chain_id,
    current_content_hash,
    current_hash_version
  ) REFERENCES mail_outbound_revisions (
    id,
    revision_chain_id,
    content_hash,
    hash_version
  ),
  FOREIGN KEY (
    approved_revision_id,
    revision_chain_id,
    approved_content_hash,
    approved_hash_version
  ) REFERENCES mail_outbound_revisions (
    id,
    revision_chain_id,
    content_hash,
    hash_version
  ),
  CHECK (status IN ('pending', 'returned', 'withdrawn', 'approved')),
  CHECK (priority IN ('normal', 'urgent')),
  CHECK (workflow_version >= 1),
  CHECK (current_hash_version >= 1),
  CHECK (approved_hash_version IS NULL OR approved_hash_version >= 1),
  CHECK (
    status = 'approved'
    AND approved_revision_id IS NOT NULL
    AND approved_content_hash IS NOT NULL
    AND approved_hash_version IS NOT NULL
    OR
    status != 'approved'
    AND approved_revision_id IS NULL
    AND approved_content_hash IS NULL
    AND approved_hash_version IS NULL
  ),
  CHECK (
    status != 'approved'
    OR
    (
      approved_revision_id = current_revision_id
      AND approved_content_hash = current_content_hash
      AND approved_hash_version = current_hash_version
    )
  ),
  CHECK (
    status = 'pending'
    AND resolved_at IS NULL
    AND resolved_by_user_id IS NULL
    OR
    status IN ('returned', 'withdrawn', 'approved')
    AND resolved_at IS NOT NULL
  ),
  CHECK (
    status = 'pending'
    OR
    next_reminder_at IS NULL
  )
);

CREATE UNIQUE INDEX uq_mail_outbound_approvals_revision_chain_id
  ON mail_outbound_approvals (revision_chain_id);

CREATE UNIQUE INDEX uq_mail_outbound_approvals_id_revision_chain_id
  ON mail_outbound_approvals (id, revision_chain_id);

CREATE INDEX idx_mail_outbound_approvals_status_requested_at
  ON mail_outbound_approvals (status, requested_at);

CREATE INDEX idx_mail_outbound_approvals_current_revision_id
  ON mail_outbound_approvals (current_revision_id);

CREATE INDEX idx_mail_outbound_approvals_approved_revision_id
  ON mail_outbound_approvals (approved_revision_id);

CREATE INDEX idx_mail_outbound_approvals_next_reminder_at
  ON mail_outbound_approvals (next_reminder_at);

-- ---------------------------------------------------------------------------
-- mail_outbound_approval_events — append-only workflow/audit events
--
-- Immutable historical evidence. No updated_at. No mutable event status. No CASCADE.
-- Return/resubmit reason/comment belongs here (not a sole mutable return_reason on Approval).
--
-- revision_chain_id: required — every event belongs to an Approval workflow chain.
-- FK (approval_id, revision_chain_id) ensures event chain matches approval chain.
--
-- Event revision provenance: revision_id + revision_chain_id + content_hash + hash_version
-- travel together when present. FK to mail_outbound_revisions chain composite guarantees
-- Event Approval Chain == Event Revision Chain.
--
--   revision_id IS NULL  -> content_hash IS NULL AND hash_version IS NULL
--   revision_id IS NOT NULL -> content_hash IS NOT NULL AND hash_version IS NOT NULL
--
-- submitted / resubmitted / returned / withdrawn / approved / admin_edit:
--   revision provenance required (NOT NULL).
-- reminder_sent: revision provenance MAY be NULL.
--
-- workflow_version: immutable snapshot at event time (NOT NULL). Changes only on non-reminder
-- transitions; each committed transition version has exactly one matching transition event.
-- Partial UNIQUE: at most one transition event per (approval_id, workflow_version).
-- reminder_sent excluded; records current version without incrementing Approval.
--
-- Secure File operational artifacts (tokens, URLs, presigned links, expires_at timestamps)
-- are NOT approval events — they belong to future delivery domain.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_approval_events (
  id TEXT PRIMARY KEY NOT NULL,
  approval_id TEXT NOT NULL,
  revision_chain_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  actor_user_id TEXT,
  revision_id TEXT,
  content_hash TEXT,
  hash_version INTEGER,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (approval_id, revision_chain_id)
    REFERENCES mail_outbound_approvals (id, revision_chain_id),
  FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (revision_id, revision_chain_id, content_hash, hash_version)
    REFERENCES mail_outbound_revisions (id, revision_chain_id, content_hash, hash_version),
  CHECK (event_type IN (
    'submitted',
    'resubmitted',
    'returned',
    'withdrawn',
    'approved',
    'admin_edit',
    'reminder_sent'
  )),
  CHECK (hash_version IS NULL OR hash_version >= 1),
  CHECK (workflow_version >= 1),
  CHECK (
    revision_id IS NULL
    AND content_hash IS NULL
    AND hash_version IS NULL
    OR
    revision_id IS NOT NULL
    AND content_hash IS NOT NULL
    AND hash_version IS NOT NULL
  ),
  CHECK (
    event_type NOT IN (
      'submitted',
      'resubmitted',
      'returned',
      'withdrawn',
      'approved',
      'admin_edit'
    )
    OR
    (
      revision_id IS NOT NULL
      AND content_hash IS NOT NULL
      AND hash_version IS NOT NULL
    )
  )
);

CREATE INDEX idx_mail_outbound_approval_events_approval_created
  ON mail_outbound_approval_events (approval_id, created_at);

CREATE INDEX idx_mail_outbound_approval_events_actor_user_id
  ON mail_outbound_approval_events (actor_user_id);

CREATE INDEX idx_mail_outbound_approval_events_revision_id
  ON mail_outbound_approval_events (revision_id);

CREATE UNIQUE INDEX uq_mail_outbound_approval_events_transition_per_version
  ON mail_outbound_approval_events (approval_id, workflow_version)
  WHERE event_type != 'reminder_sent';
