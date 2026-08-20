-- Phase 2B.12: Logical Send Operation + Transport Attempt schema
-- Phase 2B.12.1: Send orchestration concurrency pre-apply hardening (same migration — NOT applied yet)
-- ADDITIVE ONLY. No seed data. Depends on 0052–0056.
--
-- Three state-owner rule (LOCKED):
--   Approval (0056): authorization / workflow state only
--   Send Operation (this migration): logical send orchestration state
--   Transport Attempt (this migration): individual provider submission attempt
--   Delivery: NOT part of 0057 — no delivered/bounced/opened/clicked here
--
-- One immutable mail_outbound_revision → AT MOST ONE mail_send_operation (UNIQUE).
-- Retries are additional mail_transport_attempts under the SAME Send Operation.
-- Intentional resend of same semantic content later = NEW revision + NEW Send Operation.
--
-- Send Operation revision provenance (immutable after create):
--   outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind
--   composite FK to mail_outbound_revisions — Send must never drift to another revision/hash.
--
-- authorization_mode (exact V1): staff_approved | admin_direct
--   staff_approved: approval_id NOT NULL; revision_kind IN (staff_submit, staff_resubmit, admin_edit)
--   admin_direct: approval_id NULL; revision_kind = admin_direct
--   staff_approved composite FK (approval_id, outbound_revision_id, content_hash, hash_version)
--     → mail_outbound_approvals approved tuple (defense-in-depth; 0056 guarantees approved = current)
--
-- idempotency_key: UNIQUE, nonblank — ECHFRONT internal logical-send idempotency (NOT provider idempotency).
-- UNIQUE(outbound_revision_id) remains independent second guard.
--
-- Logical send status (exact V1): pending | processing | accepted | failed
--   pending: may dispatch/retry; completed_at NULL; next_attempt_at optional
--   processing: in-flight dispatch; completed_at NULL; next_attempt_at NULL
--   accepted: provider accepted submission; completed_at NOT NULL; next_attempt_at NULL
--   failed: terminal pre-delivery failure; completed_at NOT NULL; next_attempt_at NULL
--   NOT: sent, delivered, bounced, opened — "accepted" ≠ recipient delivery
--
-- Transport attempt state (exact V1): started | accepted | temporary_failure | permanent_failure
--   started: attempt active; completed_at NULL
--   accepted / temporary_failure / permanent_failure: completed_at NOT NULL
--   retry_after_at non-NULL only when state = temporary_failure (may be NULL for temp failure)
--   NOT: delivered, bounced — recipient bounce belongs to future Delivery Events
--
-- Retry model (service layer — NOT implemented here):
--   temporary_failure → same Send Operation may get another Transport Attempt
--   permanent_failure → service normally marks Send Operation failed
--   accepted attempt → service marks Send Operation accepted
--   attempt_count derived from mail_transport_attempts — no duplicate on Send Operation
--
-- initiated_by_user_id: user who caused Send Operation creation (Approve & Send Admin, etc.)
--   ON DELETE SET NULL — history survives user lifecycle. Role validation = service layer.
--
-- Mutable after create (service): status, orchestration_version, next_attempt_at, completed_at.
-- Immutable after create: revision provenance, authorization_mode, approval_id, idempotency_key.
--
-- orchestration_version (2B.12.1): optimistic concurrency generation for logical-send orchestration.
--   Starts at 1. Protects against stale workers when status values repeat (e.g. pending v1 →
--   processing v2 → pending v3 → processing v4 — stale worker holding v2 must NOT mutate v4).
--   Future service CAS on logical transitions:
--     UPDATE mail_send_operations SET status=..., next_attempt_at=..., completed_at=...,
--       orchestration_version = orchestration_version + 1
--     WHERE id = ? AND orchestration_version = ? AND status = ?
--   Zero affected rows → stale/conflict — caller must NOT continue as if transition succeeded.
--   Increment whenever logical execution state changes: pending→processing, processing→pending,
--   processing→accepted, processing→failed, and scheduling mutations coupled to those transitions.
--   Do NOT increment for transport error text or provider IDs on Attempt rows.
--   orchestration_version belongs ONLY to mail_send_operations — NOT on Transport Attempts.
--
-- Terminal logical send states (V1 service contract — no triggers):
--   accepted: terminal logical submission state
--   failed: terminal logical submission state
--   Future service must NOT transition accepted→pending/processing or failed→pending/processing
--   unless a future explicit recovery design creates a new version/domain rule.
--
-- One active started Attempt (2B.12.1): partial UNIQUE on mail_transport_attempts(send_operation_id)
--   WHERE state = 'started' — AT MOST ONE started Attempt per Send Operation.
--   Attempt #2 started + Attempt #3 started for same Send → REJECTED.
--   Once Attempt #2 becomes accepted/temporary_failure/permanent_failure, a new started Attempt
--   may be created. UNIQUE(send_operation_id, attempt_number) remains independent guard.
--
-- Future atomic dispatch contract (service layer — NOT implemented here):
--   Claiming pending Send + creating started Transport Attempt = one safely orchestrated operation.
--   Required: (A) CAS pending Send using expected orchestration_version; (B) move to processing
--   and increment orchestration_version; (C) create exactly one started Attempt; (D) if Send CAS
--   failed, no valid started Attempt remains; (E) if Attempt INSERT fails, Send must not remain
--   falsely processing. Exact D1 guarded/batch SQL designed before Transport implementation.
--   POST-BATCH meta.changes inspection is diagnostic only — NOT the rollback guarantee.
--
-- Temporary failure retry model (service layer):
--   processing vN + Attempt #N temporary_failure → Send pending vN+1 (next_attempt_at optional).
--   Later retry: pending vN+1 → processing vN+2 + NEW attempt_number. Do NOT reuse old Attempt row.
--
-- Accepted / permanent failure model (service layer):
--   Attempt accepted → Send accepted + completed_at (orchestration-version CAS).
--   Attempt permanent_failure → Send normally failed + completed_at (orchestration-version CAS).
--   accepted != delivered; permanent transport failure != recipient bounce. Delivery separate.
--
-- Processing concurrency: one active transport dispatch per Send Operation — enforced by partial
--   UNIQUE started Attempt + future service orchestration_version CAS; no lease/queue schema.
--
-- Initial Send Operation status: pending (NOT processing; no automatic Attempt via schema).
--
-- SECURITY-CRITICAL staff_approved Send (service layer — NOT implemented here):
--   1. Load exact outbound revision
--   2. Recompute FROZEN Canonical Content Hash v1
--   3. Verify revision stored hash/version
--   4. Load Approval; verify status = approved
--   5. Verify approved revision/hash/version == target revision
--   6. Verify authorization / mailbox / sender identity permissions
--   7. Create Send Operation idempotently
--
-- SECURITY-CRITICAL admin_direct Send (service layer — NOT implemented here):
--   Verify revision_kind = admin_direct; Mail Admin/Super Admin send permission;
--   mailbox membership; sender identity grant; From snapshot matches authorized identity;
--   Canonical Hash recomputes successfully. Super Admin does NOT bypass sender grant unless
--   frozen product policy explicitly grants that identity.
--
-- Approve & Send: Approval transition to approved + Send Operation creation orchestrated safely
--   by future service — do NOT merge Approval status with Send status.
--   Approval may be approved while Send is pending/processing/accepted/failed.
--
-- No ON DELETE CASCADE. Revision / Approval / Send provenance: RESTRICT / NO ACTION.
-- No provider credentials, secrets, or raw response blobs in Transport Attempts.

-- ---------------------------------------------------------------------------
-- Candidate keys on frozen tables (0054/0056 NOT edited — added here in 0057)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_chain_hash_version_kind
  ON mail_outbound_revisions (
    id,
    revision_chain_id,
    content_hash,
    hash_version,
    revision_kind
  );

CREATE UNIQUE INDEX uq_mail_outbound_approvals_id_approved_revision_hash
  ON mail_outbound_approvals (
    id,
    approved_revision_id,
    approved_content_hash,
    approved_hash_version
  );

-- ---------------------------------------------------------------------------
-- mail_send_operations — one logical send per immutable outbound revision
-- ---------------------------------------------------------------------------
CREATE TABLE mail_send_operations (
  id TEXT PRIMARY KEY NOT NULL,
  outbound_revision_id TEXT NOT NULL,
  revision_chain_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  hash_version INTEGER NOT NULL,
  revision_kind TEXT NOT NULL,
  authorization_mode TEXT NOT NULL,
  approval_id TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  orchestration_version INTEGER NOT NULL DEFAULT 1,
  initiated_by_user_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  next_attempt_at TEXT,
  FOREIGN KEY (approval_id) REFERENCES mail_outbound_approvals (id),
  FOREIGN KEY (
    outbound_revision_id,
    revision_chain_id,
    content_hash,
    hash_version,
    revision_kind
  ) REFERENCES mail_outbound_revisions (
    id,
    revision_chain_id,
    content_hash,
    hash_version,
    revision_kind
  ),
  FOREIGN KEY (
    approval_id,
    outbound_revision_id,
    content_hash,
    hash_version
  ) REFERENCES mail_outbound_approvals (
    id,
    approved_revision_id,
    approved_content_hash,
    approved_hash_version
  ),
  FOREIGN KEY (initiated_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK (authorization_mode IN ('staff_approved', 'admin_direct')),
  CHECK (revision_kind IN ('staff_submit', 'staff_resubmit', 'admin_edit', 'admin_direct')),
  CHECK (status IN ('pending', 'processing', 'accepted', 'failed')),
  CHECK (hash_version >= 1),
  CHECK (orchestration_version >= 1),
  CHECK (LENGTH(TRIM(idempotency_key)) > 0),
  CHECK (
    authorization_mode = 'staff_approved'
    AND approval_id IS NOT NULL
    AND revision_kind IN ('staff_submit', 'staff_resubmit', 'admin_edit')
    OR
    authorization_mode = 'admin_direct'
    AND approval_id IS NULL
    AND revision_kind = 'admin_direct'
  ),
  CHECK (
    status = 'pending'
    AND completed_at IS NULL
    OR
    status = 'processing'
    AND completed_at IS NULL
    AND next_attempt_at IS NULL
    OR
    status = 'accepted'
    AND completed_at IS NOT NULL
    AND next_attempt_at IS NULL
    OR
    status = 'failed'
    AND completed_at IS NOT NULL
    AND next_attempt_at IS NULL
  ),
  CHECK (
    status = 'pending'
    OR
    next_attempt_at IS NULL
  )
);

CREATE UNIQUE INDEX uq_mail_send_operations_outbound_revision_id
  ON mail_send_operations (outbound_revision_id);

CREATE UNIQUE INDEX uq_mail_send_operations_idempotency_key
  ON mail_send_operations (idempotency_key);

CREATE INDEX idx_mail_send_operations_status_next_attempt_at
  ON mail_send_operations (status, next_attempt_at);

CREATE INDEX idx_mail_send_operations_approval_id
  ON mail_send_operations (approval_id);

CREATE INDEX idx_mail_send_operations_initiated_by_user_id
  ON mail_send_operations (initiated_by_user_id);

CREATE INDEX idx_mail_send_operations_revision_chain_id
  ON mail_send_operations (revision_chain_id);

-- ---------------------------------------------------------------------------
-- mail_transport_attempts — one provider submission attempt per row
-- ---------------------------------------------------------------------------
CREATE TABLE mail_transport_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  send_operation_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  state TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_request_id TEXT,
  provider_message_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  retry_after_at TEXT,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations (id),
  CHECK (attempt_number >= 1),
  CHECK (state IN ('started', 'accepted', 'temporary_failure', 'permanent_failure')),
  CHECK (LENGTH(TRIM(provider)) > 0),
  CHECK (
    state = 'started'
    AND completed_at IS NULL
    OR
    state IN ('accepted', 'temporary_failure', 'permanent_failure')
    AND completed_at IS NOT NULL
  ),
  CHECK (
    state = 'temporary_failure'
    OR
    retry_after_at IS NULL
  )
);

CREATE UNIQUE INDEX uq_mail_transport_attempts_send_operation_attempt_number
  ON mail_transport_attempts (send_operation_id, attempt_number);

CREATE UNIQUE INDEX uq_mail_transport_attempts_one_started_per_send_operation
  ON mail_transport_attempts (send_operation_id)
  WHERE state = 'started';

CREATE INDEX idx_mail_transport_attempts_send_operation_started_at
  ON mail_transport_attempts (send_operation_id, started_at);

CREATE INDEX idx_mail_transport_attempts_state
  ON mail_transport_attempts (state);

CREATE INDEX idx_mail_transport_attempts_provider_message_id
  ON mail_transport_attempts (provider_message_id);
