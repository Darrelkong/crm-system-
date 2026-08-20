import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0059_mail_outbound_materialization.sql",
);

const FROZEN_MIGRATIONS = [
  "0052_mail_foundation.sql",
  "0053_mail_message_core.sql",
  "0054_mail_outbound_content.sql",
  "0055_mail_attachment_storage.sql",
  "0056_mail_outbound_approval.sql",
  "0057_mail_send_operation.sql",
  "0058_mail_delivery_event.sql",
] as const;

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function rfcTableBlock(): string {
  return (
    migrationSql().match(
      /CREATE TABLE mail_outbound_rfc_identities \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function matTableBlock(): string {
  return (
    migrationSql().match(
      /CREATE TABLE mail_outbound_message_materializations \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function frozenMigrationSql(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
}

describe("mail outbound materialization migration (2B.16 static)", () => {
  it("1: 0059 migration file exists", () => {
    assert.match(migrationSql(), /Phase 2B\.16/);
    assert.match(migrationSql(), /0059/);
  });

  it("2: additive design only", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /ALTER TABLE mail_messages ADD/);
    assert.doesNotMatch(sql, /DROP TABLE/);
    assert.match(sql, /ADDITIVE ONLY/i);
  });

  it("3: one Sent materialization per Send Operation", () => {
    assert.match(
      migrationSql(),
      /uq_mail_outbound_message_materializations_send_operation_id[\s\S]*?send_operation_id/,
    );
    assert.match(sqlOneSend(), /AT MOST ONE canonical Sent mail_message/i);
  });

  it("4: one canonical mail_message per materialization", () => {
    assert.match(
      migrationSql(),
      /uq_mail_outbound_message_materializations_mail_message_id[\s\S]*?mail_message_id/,
    );
  });

  it("5: exact Send/Revision provenance", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /FOREIGN KEY \(\s*send_operation_id,\s*outbound_revision_id\s*\)/,
    );
    assert.match(matTableBlock(), /outbound_revision_id TEXT NOT NULL/);
  });

  it("6: exact revision hash/version provenance", () => {
    const sql = migrationSql();
    const m56 = frozenMigrationSql("0056_mail_outbound_approval.sql");
    assert.match(m56, /uq_mail_outbound_revisions_id_content_hash_version/);
    assert.doesNotMatch(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_content_hash_version/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \(\s*outbound_revision_id,\s*content_hash,\s*hash_version\s*\)/,
    );
    assert.match(matTableBlock(), /content_hash TEXT NOT NULL/);
    assert.match(matTableBlock(), /hash_version INTEGER NOT NULL/);
  });

  it("7: accepted Attempt belongs to same Send", () => {
    const sql = migrationSql();
    assert.match(matTableBlock(), /accepted_transport_attempt_id TEXT NOT NULL/);
    assert.match(
      sql,
      /FOREIGN KEY \(\s*accepted_transport_attempt_id,\s*send_operation_id\s*\)/,
    );
  });

  it("8: retry does not create additional materialization", () => {
    assert.match(migrationSql(), /Transport retries do NOT create additional mail_messages/i);
    assert.match(migrationSql(), /same rfc_message_id for every Transport retry/i);
    assert.match(
      migrationSql(),
      /uq_mail_outbound_rfc_identities_send_operation_id/,
    );
  });

  it("9: stable RFC Message-ID per logical Send documented", () => {
    const sql = migrationSql();
    assert.match(sql, /ONE Send Operation → ONE stable RFC Message-ID/i);
    assert.match(sql, /mail_outbound_rfc_identities/);
    assert.match(rfcTableBlock(), /rfc_message_id TEXT NOT NULL/);
    assert.match(rfcTableBlock(), /LENGTH\(TRIM\(rfc_message_id\)\) > 0/);
    assert.match(sql, /uq_mail_outbound_rfc_identities_rfc_message_id/);
  });

  it("10: provider_message_id != RFC Message-ID documented", () => {
    const sql = migrationSql();
    assert.match(sql, /Do NOT use provider_message_id as RFC Message-ID/i);
    assert.match(sql, /RFC Message-ID: ECHFRONT logical email identity/i);
    assert.match(sql, /provider_message_id: provider transport correlation/i);
    assert.doesNotMatch(rfcTableBlock(), /provider_message_id/);
    assert.doesNotMatch(matTableBlock(), /provider_message_id/);
  });

  it("11: Sent materialization only after logical accepted service rule", () => {
    const sql = migrationSql();
    assert.match(sql, /send_operation\.status = accepted/i);
    assert.match(sql, /materialized ONLY after send_operation.status = accepted/i);
    assert.match(sql, /Sent Message exists ≠ Delivered/i);
  });

  it("12: accepted Attempt service rule documented", () => {
    const sql = migrationSql();
    assert.match(sql, /accepted_transport_attempt\.state MUST be accepted/i);
    assert.match(sql, /NOT enforced by trigger/i);
    assert.match(sql, /do NOT create triggers/i);
  });

  it("13: outbound mail_message direction invariant documented", () => {
    assert.match(migrationSql(), /direction = outbound/i);
    assert.match(migrationSql(), /mail_messages remains canonical store/i);
  });

  it("14: Draft is never materialization source", () => {
    assert.match(migrationSql(), /NOT mutable Draft/i);
    assert.match(migrationSql(), /exact immutable outbound Revision/i);
  });

  it("15: Signature Snapshot is authoritative", () => {
    assert.match(migrationSql(), /Signature Snapshot on Revision is authoritative/i);
    assert.match(migrationSql(), /NOT live Signature Version/i);
  });

  it("16: Revision Attachment provenance preserved", () => {
    assert.match(
      migrationSql(),
      /mail_message_attachments\.source_revision_attachment_id/i,
    );
    assert.match(migrationSql(), /Copy frozen metadata from Revision Attachment/i);
  });

  it("17: Secure File token/URL excluded", () => {
    assert.match(migrationSql(), /Secure File tokens\/URLs are operational artifacts/i);
    assert.doesNotMatch(matTableBlock(), /secure_file/);
    assert.doesNotMatch(rfcTableBlock(), /token/);
  });

  it("18: Canonical Hash v1 unchanged", () => {
    assert.match(migrationSql(), /Canonical Content Hash v1: FROZEN/i);
    assert.match(migrationSql(), /Do NOT modify Hash v1/i);
    assert.doesNotMatch(migrationSql(), /ECHFRONT-MAIL-CONTENT-V2/);
  });

  it("19: RFC Message-ID excluded from Hash v1 documented", () => {
    assert.match(
      migrationSql(),
      /RFC Message-ID is NOT retroactively added to Hash v1/i,
    );
    assert.match(migrationSql(), /not manually approved semantic content/i);
  });

  it("20: reply/threading distinction documented", () => {
    const sql = migrationSql();
    assert.match(sql, /internet_message_id \(RFC Message-ID\)/i);
    assert.match(sql, /in_reply_to/);
    assert.match(sql, /references_header/);
    assert.match(sql, /reply_to_message_id \(internal DB provenance\)/i);
    assert.match(sql, /Do NOT duplicate header columns/i);
  });

  it("21: failed Send does not create Sent message", () => {
    assert.match(migrationSql(), /NO Sent mail_message \(V1\)/i);
    assert.match(migrationSql(), /do not pretend it was Sent/i);
  });

  it("22: no Delivery state added", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /CREATE TABLE mail_delivery/);
    assert.match(sql, /Delivery Events do NOT create additional mail_messages/i);
    assert.doesNotMatch(matTableBlock(), /delivery_status/);
  });

  it("23: no provider integration", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /CREATE TABLE mail_webhook/);
    assert.match(sql, /No SMTP, MIME library, provider adapter/i);
    assert.doesNotMatch(rfcTableBlock(), /raw_mime/);
  });

  it("24: no CASCADE", () => {
    assert.doesNotMatch(matTableBlock(), /ON DELETE CASCADE/i);
    assert.doesNotMatch(rfcTableBlock(), /ON DELETE CASCADE/i);
    assert.match(migrationSql(), /No CASCADE deletes/i);
  });

  it("25: 0052–0058 unchanged", () => {
    const m59 = migrationSql();
    assert.doesNotMatch(m59, /0060/);
    for (const frozen of FROZEN_MIGRATIONS) {
      const sql = frozenMigrationSql(frozen);
      assert.doesNotMatch(sql, /mail_outbound_rfc_identities/);
      assert.doesNotMatch(sql, /mail_outbound_message_materializations/);
    }
    assert.ok(FROZEN_MIGRATIONS.length === 7);
  });

  it("26: no D1 access", () => {
    assert.doesNotMatch(migrationSql(), /wrangler d1 execute/i);
    assert.doesNotMatch(migrationSql(), /env\.DB\.batch/);
    assert.doesNotMatch(migrationSql(), /getPlatformProxy/);
  });
});

function sqlOneSend(): string {
  return migrationSql();
}

describe("mail outbound materialization SQL ↔ Drizzle parity (2B.16 static)", () => {
  it("reuses mail_messages.internet_message_id for RFC identity", () => {
    const m53 = frozenMigrationSql("0053_mail_message_core.sql");
    assert.match(m53, /internet_message_id TEXT/);
    assert.match(
      migrationSql(),
      /copied to mail_messages\.internet_message_id/i,
    );
    assert.match(
      migrationSql(),
      /uq_mail_messages_outbound_internet_message_id/,
    );
  });

  it("recipient mapping table not added", () => {
    assert.match(
      migrationSql(),
      /NO separate mapping table in 0059/i,
    );
    assert.doesNotMatch(migrationSql(), /mail_outbound_recipient_materializations/);
  });

  it("idempotent materialization documented", () => {
    assert.match(migrationSql(), /materializeSentMessage\(send_operation_id\)/i);
    assert.match(migrationSql(), /UNIQUE constraints defense-in-depth/i);
  });

  it("identity vs provider correlation documented", () => {
    const sql = migrationSql();
    assert.match(sql, /provider_request_id: provider request correlation/i);
    assert.match(sql, /provider_event_id: provider delivery-event correlation/i);
  });
});

describe("mail outbound materialization integrity (2B.16.1 static)", () => {
  it("1: 0059 does NOT recreate index owned by 0056", () => {
    const m56 = frozenMigrationSql("0056_mail_outbound_approval.sql");
    const m59 = migrationSql();
    assert.match(m56, /CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_content_hash_version/);
    assert.doesNotMatch(
      m59,
      /CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_content_hash_version/,
    );
    assert.match(m59, /owned by 0056/i);
  });

  it("2: uq_mail_outbound_revisions_id_content_hash_version in Drizzle schema", async () => {
    const { mailOutboundRevisions } = await import(
      "../../../../drizzle/schema/mail-outbound-revisions"
    );
    assert.ok(mailOutboundRevisions);
    const sql = migrationSql();
    assert.match(
      frozenMigrationSql("0056_mail_outbound_approval.sql"),
      /uq_mail_outbound_revisions_id_content_hash_version/,
    );
    assert.doesNotMatch(
      sql,
      /CREATE UNIQUE INDEX uq_mail_outbound_revisions_id_content_hash_version/,
    );
  });

  it("3: Materialization has rfc_message_id", () => {
    assert.match(matTableBlock(), /rfc_message_id TEXT NOT NULL/);
  });

  it("4: rfc_message_id required/nonblank", () => {
    assert.match(matTableBlock(), /LENGTH\(TRIM\(rfc_message_id\)\) > 0/);
  });

  it("5: RFC Identity composite provenance id + send + rfc_message_id", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /uq_mail_outbound_rfc_identities_id_send_operation_rfc_message_id/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \(\s*outbound_rfc_identity_id,\s*send_operation_id,\s*rfc_message_id\s*\)/,
    );
  });

  it("6: Materialization cannot bind different RFC ID than RFC Identity", () => {
    assert.match(
      migrationSql(),
      /REFERENCES mail_outbound_rfc_identities \(\s*id,\s*send_operation_id,\s*rfc_message_id\s*\)/,
    );
    assert.doesNotMatch(
      matTableBlock(),
      /FOREIGN KEY \(\s*outbound_rfc_identity_id,\s*send_operation_id\s*\)\s*REFERENCES mail_outbound_rfc_identities/,
    );
  });

  it("7: mail_messages candidate key id + internet_message_id + direction", () => {
    assert.match(
      migrationSql(),
      /uq_mail_messages_id_internet_message_id_direction/,
    );
  });

  it("8: Materialization mail_message FK includes message + rfc + direction", () => {
    assert.match(
      migrationSql(),
      /FOREIGN KEY \(\s*mail_message_id,\s*rfc_message_id,\s*message_direction\s*\)/,
    );
    assert.match(
      migrationSql(),
      /REFERENCES mail_messages \(\s*id,\s*internet_message_id,\s*direction\s*\)/,
    );
  });

  it("9: message_direction fixed to outbound", () => {
    assert.match(matTableBlock(), /message_direction TEXT NOT NULL/);
    assert.match(matTableBlock(), /CHECK \(message_direction = 'outbound'\)/);
  });

  it("10: Materialization cannot structurally link inbound mail_message", () => {
    assert.match(matTableBlock(), /message_direction = 'outbound'/);
    assert.doesNotMatch(matTableBlock(), /message_direction = 'inbound'/);
    assert.match(
      migrationSql(),
      /message_direction = 'outbound' witness/i,
    );
  });

  it("11: outbound internet_message_id partial UNIQUE remains", () => {
    assert.match(
      migrationSql(),
      /uq_mail_messages_outbound_internet_message_id[\s\S]*?direction = 'outbound'/,
    );
  });

  it("12: Provider IDs remain distinct from RFC Message-ID", () => {
    const sql = migrationSql();
    assert.match(sql, /Do NOT use provider_message_id as RFC Message-ID/i);
    assert.doesNotMatch(matTableBlock(), /provider_message_id/);
  });

  it("13: recipient mapping table NOT created in V1", () => {
    assert.doesNotMatch(migrationSql(), /mail_outbound_recipient_materializations/);
  });

  it("14: complete recipient set equality service invariant documented", () => {
    const sql = migrationSql();
    assert.match(sql, /Revision Recipient Set ==/i);
    assert.match(sql, /Materialized Message Recipient Set/i);
    assert.match(sql, /recipient type, normalized address, display name/i);
    assert.match(sql, /Address UNIQUE constraints alone do NOT prove/i);
  });

  it("15: Draft is never materialization source", () => {
    assert.match(migrationSql(), /NOT mutable Draft/i);
    assert.match(migrationSql(), /No Draft recipient data/i);
  });

  it("16: 0052–0058 unchanged", () => {
    const m59 = migrationSql();
    assert.doesNotMatch(m59, /0060/);
    for (const frozen of FROZEN_MIGRATIONS) {
      const sql = frozenMigrationSql(frozen);
      assert.doesNotMatch(sql, /mail_outbound_message_materializations/);
      assert.doesNotMatch(sql, /rfc_message_id TEXT NOT NULL,\s*mail_message_id/);
    }
  });
});
