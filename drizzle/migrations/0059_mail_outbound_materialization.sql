-- Phase 2B.16: Outbound Sent Message Materialization + Stable RFC Identity
-- ADDITIVE ONLY. No seed data. Depends on 0052–0058.
--
-- Purpose: provenance boundary from immutable outbound Revision → logical Send Operation
--   → accepted Transport Attempt → canonical outbound mail_message in Sent.
--
-- Locked V1 rules:
--   ONE logical Send Operation → AT MOST ONE canonical Sent mail_message.
--   Transport retries do NOT create additional mail_messages.
--   Delivery Events do NOT create additional mail_messages.
--   Sent Message exists ≠ Delivered (Delivery Events remain separate).
--
-- Materialization timing (service layer — NOT trigger):
--   Canonical Sent mail_message materialized ONLY after send_operation.status = accepted.
--   accepted means provider accepted submission — NOT recipient delivery.
--   Failed Send (terminal failed without provider acceptance) → NO Sent mail_message (V1).
--   do not pretend it was Sent.
--
-- Stable RFC Message-ID (LOCKED):
--   ONE Send Operation → ONE stable RFC Message-ID reused across every Transport retry.
--   Do NOT generate new RFC Message-ID per Transport Attempt.
--   mail_outbound_rfc_identities holds immutable transport-ready RFC identity 1:1 with Send.
--   At materialization, rfc_message_id is copied to mail_messages.internet_message_id.
--   Do NOT use provider_message_id as RFC Message-ID — different concepts:
--     RFC Message-ID: ECHFRONT logical email identity
--     provider_request_id: provider request correlation
--     provider_message_id: provider transport correlation (mail_transport_attempts)
--     provider_event_id: provider delivery-event correlation (mail_delivery_events)
--
-- Retry example: Send S1, Attempt #1/#2 temporary_failure, Attempt #3 accepted —
--   all attempts share SAME rfc_message_id; exactly ONE mail_message after acceptance.
--
-- Accepted Attempt service invariant (NOT enforced by trigger — do NOT create triggers):
--   Before materialization: send_operation.status MUST be accepted;
--   accepted_transport_attempt.state MUST be accepted.
-- DB FK proves Attempt belongs to Send; static FK cannot prove mutable state at insert.
--
-- Outbound direction (service invariant):
--   Materialized mail_message MUST be direction = outbound.
--   mail_messages remains canonical store — no duplicate outbound message table.
--
-- Exact Revision copy contract (service layer):
--   Copy/freeze from exact immutable outbound Revision — NOT mutable Draft.
--   Sender snapshot, subject, body, recipients, sensitivity, compose/threading,
--   signature-rendered final content, attachments from Revision provenance.
--   Signature Snapshot on Revision is authoritative — NOT live Signature Version.
--
-- Recipient materialization: NO separate mapping table in 0059.
--   mail_message_recipients copied 1:1 from mail_outbound_revision_recipients by service.
--   Address UNIQUE constraints alone do NOT prove complete recipient set copied correctly.
--   Future materialization service MUST compare complete immutable recipient semantic set
--   (recipient type, normalized address, display name): Revision Recipient Set ==
--   Materialized Message Recipient Set (To/Cc/Bcc). No Draft recipient data.
--
-- RFC identity vs materialized message (2B.16.1 DB defense-in-depth):
--   mail_outbound_message_materializations.rfc_message_id MUST equal
--   mail_outbound_rfc_identities.rfc_message_id AND mail_messages.internet_message_id.
--   message_direction = 'outbound' witness + composite FK proves outbound mail_message link.
--   RFC Identity may exist before acceptance; Sent mail_message only after Send accepted.
--
-- Attachment materialization: preserve mail_message_attachments.source_revision_attachment_id
--   (0055). Copy frozen metadata from Revision Attachment — NOT mutable Draft attachment.
--   Secure File tokens/URLs are operational artifacts — not canonical attachment provenance.
--
-- Threading / RFC headers: reuse existing mail_messages fields:
--   internet_message_id (RFC Message-ID), in_reply_to, references_header,
--   reply_to_message_id (internal DB provenance). Do NOT duplicate header columns.
--
-- Canonical Content Hash v1: FROZEN. Materialization does NOT recompute a different hash.
--   Service must verify revision hash/version == recomputed Frozen Canonical Hash v1.
--   RFC Message-ID is NOT retroactively added to Hash v1 — transport identity is operational,
--   not manually approved semantic content. Do NOT modify Hash v1.
--
-- Message-ID generation contract (service layer — algorithm not implemented here):
--   deterministic/stable for one logical Send once created;
--   syntactically valid RFC Message-ID form; no sensitive data embedded;
--   no sequential customer ID leakage; retries reuse same value;
--   globally collision-resistant within ECHFRONT Mail.
--
-- Idempotent materialization: materializeSentMessage(send_operation_id) retries must resolve
--   to SAME mail_message + materialization record — UNIQUE constraints defense-in-depth.
--
-- Delivery relationship: Delivery Events reference Send/Attempt/Revision Recipient — NOT
--   mail_message. Future UI joins Sent message → materialization → Send → Delivery Events.
--
-- No CASCADE deletes. Materialization provenance preserves Send, Revision, Attempt,
--   canonical mail_message while materialization exists. No delete API now.
--
-- No SMTP, MIME library, provider adapter, webhook routes, raw MIME storage, or API routes.
--
-- Phase 2B.16.1: RFC/materialization composite provenance hardening (same migration — NOT applied yet).
--   uq_mail_outbound_revisions_id_content_hash_version owned by 0056 — NOT recreated here.
--   Materialization stores rfc_message_id + message_direction witnesses with composite FKs.

-- ---------------------------------------------------------------------------
-- Candidate keys on existing tables (0053/0056 NOT edited — added here in 0059)
-- ---------------------------------------------------------------------------
-- Outbound RFC Message-ID uniqueness on canonical message store (defense-in-depth).
CREATE UNIQUE INDEX uq_mail_messages_outbound_internet_message_id
  ON mail_messages (internet_message_id)
  WHERE internet_message_id IS NOT NULL AND direction = 'outbound';

-- Composite provenance candidate for materialization → mail_messages RFC + direction binding.
CREATE UNIQUE INDEX uq_mail_messages_id_internet_message_id_direction
  ON mail_messages (id, internet_message_id, direction);

-- ---------------------------------------------------------------------------
-- mail_outbound_rfc_identities — stable RFC Message-ID per logical Send Operation
--
-- Created when Send becomes transport-ready (before/during dispatch).
-- Immutable after create — same rfc_message_id for every Transport retry.
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_rfc_identities (
  id TEXT PRIMARY KEY NOT NULL,
  send_operation_id TEXT NOT NULL,
  outbound_revision_id TEXT NOT NULL,
  rfc_message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations (id),
  FOREIGN KEY (outbound_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (
    send_operation_id,
    outbound_revision_id
  ) REFERENCES mail_send_operations (
    id,
    outbound_revision_id
  ),
  CHECK (LENGTH(TRIM(rfc_message_id)) > 0)
);

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_send_operation_id
  ON mail_outbound_rfc_identities (send_operation_id);

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_rfc_message_id
  ON mail_outbound_rfc_identities (rfc_message_id);

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_id_send_operation_id
  ON mail_outbound_rfc_identities (id, send_operation_id);

CREATE UNIQUE INDEX uq_mail_outbound_rfc_identities_id_send_operation_rfc_message_id
  ON mail_outbound_rfc_identities (id, send_operation_id, rfc_message_id);

CREATE INDEX idx_mail_outbound_rfc_identities_outbound_revision_id
  ON mail_outbound_rfc_identities (outbound_revision_id);

-- ---------------------------------------------------------------------------
-- mail_outbound_message_materializations — Send → accepted Attempt → Sent message
--
-- ONE row per logical Send Operation. ONE canonical mail_message per materialization.
-- Created only after send_operation.status = accepted (service layer).
-- ---------------------------------------------------------------------------
CREATE TABLE mail_outbound_message_materializations (
  id TEXT PRIMARY KEY NOT NULL,
  send_operation_id TEXT NOT NULL,
  outbound_revision_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  hash_version INTEGER NOT NULL,
  accepted_transport_attempt_id TEXT NOT NULL,
  outbound_rfc_identity_id TEXT NOT NULL,
  rfc_message_id TEXT NOT NULL,
  mail_message_id TEXT NOT NULL,
  message_direction TEXT NOT NULL,
  materialized_at TEXT NOT NULL,
  FOREIGN KEY (send_operation_id) REFERENCES mail_send_operations (id),
  FOREIGN KEY (outbound_revision_id) REFERENCES mail_outbound_revisions (id),
  FOREIGN KEY (accepted_transport_attempt_id) REFERENCES mail_transport_attempts (id),
  FOREIGN KEY (outbound_rfc_identity_id) REFERENCES mail_outbound_rfc_identities (id),
  FOREIGN KEY (mail_message_id) REFERENCES mail_messages (id),
  FOREIGN KEY (
    send_operation_id,
    outbound_revision_id
  ) REFERENCES mail_send_operations (
    id,
    outbound_revision_id
  ),
  FOREIGN KEY (
    outbound_revision_id,
    content_hash,
    hash_version
  ) REFERENCES mail_outbound_revisions (
    id,
    content_hash,
    hash_version
  ),
  FOREIGN KEY (
    accepted_transport_attempt_id,
    send_operation_id
  ) REFERENCES mail_transport_attempts (
    id,
    send_operation_id
  ),
  FOREIGN KEY (
    outbound_rfc_identity_id,
    send_operation_id,
    rfc_message_id
  ) REFERENCES mail_outbound_rfc_identities (
    id,
    send_operation_id,
    rfc_message_id
  ),
  FOREIGN KEY (
    mail_message_id,
    rfc_message_id,
    message_direction
  ) REFERENCES mail_messages (
    id,
    internet_message_id,
    direction
  ),
  CHECK (hash_version >= 1),
  CHECK (LENGTH(TRIM(content_hash)) > 0),
  CHECK (LENGTH(TRIM(rfc_message_id)) > 0),
  CHECK (message_direction = 'outbound')
);

CREATE UNIQUE INDEX uq_mail_outbound_message_materializations_send_operation_id
  ON mail_outbound_message_materializations (send_operation_id);

CREATE UNIQUE INDEX uq_mail_outbound_message_materializations_mail_message_id
  ON mail_outbound_message_materializations (mail_message_id);

CREATE UNIQUE INDEX uq_mail_outbound_message_materializations_outbound_rfc_identity_id
  ON mail_outbound_message_materializations (outbound_rfc_identity_id);

CREATE INDEX idx_mail_outbound_message_materializations_outbound_revision_id
  ON mail_outbound_message_materializations (outbound_revision_id);

CREATE INDEX idx_mail_outbound_message_materializations_accepted_transport_attempt_id
  ON mail_outbound_message_materializations (accepted_transport_attempt_id);
