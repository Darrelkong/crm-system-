-- Phase 2B.14: Per-recipient Delivery Event domain schema
-- ADDITIVE ONLY. No seed data. Depends on 0052–0057.
--
-- Four state-owner rule (LOCKED):
--   Approval (0056): authorization / workflow state only
--   Send Operation (0057): logical send orchestration state
--   Transport Attempt (0057): individual provider submission attempt
--   Delivery Event (this migration): per-recipient delivery outcome after provider acceptance
--
-- DELIVERY IS PER RECIPIENT. One Send Operation may produce:
--   Recipient A: delivered
--   Recipient B: deferred
--   Recipient C: bounced
-- Do NOT store one global delivered/bounced status on mail_send_operations.
--
-- Locked boundaries:
--   SEND accepted != delivered
--   TRANSPORT accepted != delivered
-- Do NOT add Delivery status columns to mail_outbound_approvals,
--   mail_send_operations, or mail_transport_attempts.
--
-- mail_delivery_events is APPEND-ONLY immutable evidence.
-- No updated_at. No mutable status. No soft overwrite of previous events.
-- Provider retry for same semantic event → same event_dedupe_key (UNIQUE).
-- Genuinely distinct events → distinct rows. Never overwrite an earlier Delivery Event.
--
-- V1 event_type (exact): deferred | delivered | bounced
--   deferred: temporary/non-terminal delivery delay reported by provider
--   delivered: recipient-side successful delivery acceptance
--   bounced: terminal non-delivery / bounce
-- NOT: accepted, processing, sending, temporary_failure, permanent_failure
--   (Send/Transport domains). NOT: opened, clicked (open tracking disabled).
--
-- Per-recipient provenance (immutable after insert):
--   send_operation_id, transport_attempt_id, outbound_revision_id,
--   outbound_revision_recipient_id
-- Composite FKs prevent Send Operation from Revision A + Recipient from Revision B.
-- Delivery Event Send Revision == Delivery Event Recipient Revision.
--
-- transport_attempt_id REQUIRED (V1). Normalized Delivery Events materialized only
-- after provider callback correlated to the accepted Transport Attempt.
-- Unmatched/unresolved provider callbacks must NOT be inserted with guessed provenance.
-- Future webhook ingestion may introduce a separate quarantine/inbox domain — not here.
--
-- SECURITY/INTEGRITY service invariant (NOT enforced by trigger — do NOT create triggers):
--   Before inserting a Delivery Event, transport_attempt.state MUST be accepted.
-- DB FK proves Attempt belongs to Send; static FK cannot prove state=accepted at insert.
-- Do NOT weaken Transport state ownership.
--
-- event_dedupe_key: ECHFRONT provider-normalized idempotency key. Nonblank, UNIQUE.
-- Future adapter: when provider supplies stable event ID, incorporate provider namespace,
--   stable provider event identity, exact recipient identity where callback is multi-recipient.
-- When provider lacks suitable unique ID, derive deterministic provider-specific fingerprint.
-- Do NOT use random UUID as semantic dedupe key. Row id may be internal generated id.
--
-- provider_event_id: optional, nonblank if set. NOT globally UNIQUE — one provider
--   callback may represent multiple recipient outcomes. event_dedupe_key is the boundary.
--
-- provider_occurred_at: provider-reported occurrence time if trustworthy/available (nullable).
-- received_at: when ECHFRONT received/materialized this normalized event (NOT NULL).
-- Do NOT require provider_occurred_at to precede received_at chronologically — clocks/webhooks may skew.
-- Do NOT use DB insertion order alone as semantic delivery chronology.
--
-- OUT-OF-ORDER EVENTS: Provider events may arrive late, duplicated, out of chronological order.
-- mail_delivery_events records immutable facts. No mutable "current delivery status" here.
-- Future projection/current-state logic must handle occurrence time, terminal semantics,
--   duplicate suppression, out-of-order arrival WITHOUT deleting historical events.
--
-- DEFERRED: A recipient may receive multiple deferred events before delivered or bounced.
-- Do NOT UNIQUE (send_operation_id, recipient_id). Multiple historical events required.
--
-- DELIVERED / BOUNCED terminality: V1 product semantics treat delivered and bounced as
-- terminal recipient outcomes for future current-state projection.
-- Do NOT reject later-arriving historical/out-of-order provider events at DB level merely because terminal Event exists.
-- Future projection service determines whether late event changes visible current state.
--
-- Diagnostic metadata (nullable, nonblank if set): smtp_status_code, smtp_enhanced_status_code,
--   diagnostic_message. No raw webhook JSON, API secrets, auth headers, tokens, response blobs.
--
-- Bounce classification: V1 event_type bounced is sufficient. Hard/soft/policy taxonomy deferred.
--
-- BCC PRIVACY: Event may reference Bcc revision recipient internally. Future read APIs must
--   preserve Bcc authorization rules. Do NOT duplicate Bcc lists into public delivery DTOs.
--
-- provider_message_id: preferred source of truth is mail_transport_attempts.provider_message_id.
-- Delivery Event references transport_attempt_id. Webhook service resolves correlation before insert.
--
-- Future materialization: Delivery Events belong to exact outbound logical send/revision.
-- "Sent" message materialization into mail_messages is separate. No dependency on UI folder placement.
--
-- No CASCADE deletes. Send/Transport/Revision/Recipient provenance RESTRICT while Events exist.
-- Long-term audit/history. No delete API now.

-- ---------------------------------------------------------------------------
-- Candidate keys on existing tables (0054/0057 NOT edited — added here in 0058)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_mail_send_operations_id_outbound_revision_id
  ON mail_send_operations (id, outbound_revision_id);

CREATE UNIQUE INDEX uq_mail_transport_attempts_id_send_operation_id
  ON mail_transport_attempts (id, send_operation_id);

CREATE UNIQUE INDEX uq_mail_outbound_revision_recipients_id_revision_id
  ON mail_outbound_revision_recipients (id, revision_id);

-- ---------------------------------------------------------------------------
-- mail_delivery_events — immutable per-recipient delivery outcome evidence
-- ---------------------------------------------------------------------------
CREATE TABLE mail_delivery_events (
  id TEXT PRIMARY KEY NOT NULL,
  send_operation_id TEXT NOT NULL,
  transport_attempt_id TEXT NOT NULL,
  outbound_revision_id TEXT NOT NULL,
  outbound_revision_recipient_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_dedupe_key TEXT NOT NULL,
  provider_event_id TEXT,
  provider_occurred_at TEXT,
  received_at TEXT NOT NULL,
  smtp_status_code TEXT,
  smtp_enhanced_status_code TEXT,
  diagnostic_message TEXT,
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations (id),
  FOREIGN KEY (transport_attempt_id) REFERENCES mail_transport_attempts (id),
  FOREIGN KEY (outbound_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (outbound_revision_recipient_id) REFERENCES mail_outbound_revision_recipients (id),
  FOREIGN KEY (
    send_operation_id,
    outbound_revision_id
  ) REFERENCES mail_send_operations (
    id,
    outbound_revision_id
  ),
  FOREIGN KEY (
    transport_attempt_id,
    send_operation_id
  ) REFERENCES mail_transport_attempts (
    id,
    send_operation_id
  ),
  FOREIGN KEY (
    outbound_revision_recipient_id,
    outbound_revision_id
  ) REFERENCES mail_outbound_revision_recipients (
    id,
    revision_id
  ),
  CHECK (event_type IN ('deferred', 'delivered', 'bounced')),
  CHECK (LENGTH(TRIM(event_dedupe_key)) > 0),
  CHECK (
    provider_event_id IS NULL
    OR LENGTH(TRIM(provider_event_id)) > 0
  ),
  CHECK (
    smtp_status_code IS NULL
    OR LENGTH(TRIM(smtp_status_code)) > 0
  ),
  CHECK (
    smtp_enhanced_status_code IS NULL
    OR LENGTH(TRIM(smtp_enhanced_status_code)) > 0
  ),
  CHECK (
    diagnostic_message IS NULL
    OR LENGTH(TRIM(diagnostic_message)) > 0
  )
);

CREATE UNIQUE INDEX uq_mail_delivery_events_event_dedupe_key
  ON mail_delivery_events (event_dedupe_key);

CREATE INDEX idx_mail_delivery_events_send_operation_received_at
  ON mail_delivery_events (send_operation_id, received_at);

CREATE INDEX idx_mail_delivery_events_recipient_received_at
  ON mail_delivery_events (outbound_revision_recipient_id, received_at);

CREATE INDEX idx_mail_delivery_events_transport_attempt_id
  ON mail_delivery_events (transport_attempt_id);

CREATE INDEX idx_mail_delivery_events_event_type_received_at
  ON mail_delivery_events (event_type, received_at);

CREATE INDEX idx_mail_delivery_events_provider_event_id
  ON mail_delivery_events (provider_event_id);
