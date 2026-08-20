import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MAIL_DELIVERY_EVENT_TYPES } from "../../../../drizzle/schema/mail-delivery-events";
import { MAIL_SEND_OPERATION_STATUSES } from "../../../../drizzle/schema/mail-send-operations";
import { MAIL_TRANSPORT_ATTEMPT_STATES } from "../../../../drizzle/schema/mail-transport-attempts";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0058_mail_delivery_event.sql",
);

const FROZEN_MIGRATIONS = [
  "0052_mail_foundation.sql",
  "0053_mail_message_core.sql",
  "0054_mail_outbound_content.sql",
  "0055_mail_attachment_storage.sql",
  "0056_mail_outbound_approval.sql",
  "0057_mail_send_operation.sql",
] as const;

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function deliveryTableBlock(): string {
  return (
    migrationSql().match(/CREATE TABLE mail_delivery_events \([\s\S]*?\);/)?.[0] ??
    ""
  );
}

function frozenMigrationSql(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
}

describe("mail delivery event migration (2B.14 static)", () => {
  it("1: 0058 migration file exists", () => {
    assert.match(migrationSql(), /Phase 2B\.14/);
    assert.match(migrationSql(), /0058/);
  });

  it("2: mail_delivery_events table exists", () => {
    assert.match(migrationSql(), /CREATE TABLE mail_delivery_events/);
  });

  it("3: event types exact deferred/delivered/bounced", () => {
    assert.match(
      deliveryTableBlock(),
      /CHECK \(event_type IN \('deferred', 'delivered', 'bounced'\)\)/,
    );
    assert.deepEqual([...MAIL_DELIVERY_EVENT_TYPES], [
      "deferred",
      "delivered",
      "bounced",
    ]);
  });

  it("4: no accepted transport status in Delivery enum", () => {
    const block = deliveryTableBlock();
    assert.doesNotMatch(block, /'accepted'/);
    assert.doesNotMatch(block, /'processing'/);
    assert.doesNotMatch(block, /'temporary_failure'/);
    assert.doesNotMatch(block, /'permanent_failure'/);
    assert.doesNotMatch(block, /'started'/);
  });

  it("5: no opened/clicked", () => {
    const sql = migrationSql();
    assert.doesNotMatch(deliveryTableBlock(), /opened/);
    assert.doesNotMatch(deliveryTableBlock(), /clicked/);
    assert.match(sql, /open tracking disabled/i);
  });

  it("6: Delivery Event immutable/no updated_at", () => {
    const block = deliveryTableBlock();
    assert.doesNotMatch(block, /updated_at/);
    assert.match(migrationSql(), /APPEND-ONLY immutable evidence/i);
    assert.match(migrationSql(), /Never overwrite an earlier Delivery Event/i);
  });

  it("7: send_operation_id required", () => {
    assert.match(deliveryTableBlock(), /send_operation_id TEXT NOT NULL/);
  });

  it("8: transport_attempt_id required", () => {
    assert.match(deliveryTableBlock(), /transport_attempt_id TEXT NOT NULL/);
    assert.match(migrationSql(), /transport_attempt_id REQUIRED/i);
  });

  it("9: outbound_revision_id required", () => {
    assert.match(deliveryTableBlock(), /outbound_revision_id TEXT NOT NULL/);
  });

  it("10: outbound_revision_recipient_id required", () => {
    assert.match(
      deliveryTableBlock(),
      /outbound_revision_recipient_id TEXT NOT NULL/,
    );
  });

  it("11: send + revision composite provenance exists", () => {
    const sql = migrationSql();
    assert.match(sql, /uq_mail_send_operations_id_outbound_revision_id/);
    assert.match(
      sql,
      /FOREIGN KEY \(\s*send_operation_id,\s*outbound_revision_id\s*\)/,
    );
    assert.match(
      sql,
      /REFERENCES mail_send_operations \(\s*id,\s*outbound_revision_id\s*\)/,
    );
  });

  it("12: transport attempt + send composite provenance exists", () => {
    const sql = migrationSql();
    assert.match(sql, /uq_mail_transport_attempts_id_send_operation_id/);
    assert.match(
      sql,
      /FOREIGN KEY \(\s*transport_attempt_id,\s*send_operation_id\s*\)/,
    );
    assert.match(
      sql,
      /REFERENCES mail_transport_attempts \(\s*id,\s*send_operation_id\s*\)/,
    );
  });

  it("13: recipient + revision composite provenance exists", () => {
    const sql = migrationSql();
    assert.match(sql, /uq_mail_outbound_revision_recipients_id_revision_id/);
    assert.match(
      sql,
      /FOREIGN KEY \(\s*outbound_revision_recipient_id,\s*outbound_revision_id\s*\)/,
    );
    assert.match(
      sql,
      /REFERENCES mail_outbound_revision_recipients \(\s*id,\s*revision_id\s*\)/,
    );
    assert.match(sql, /Delivery Event Send Revision == Delivery Event Recipient Revision/i);
  });

  it("14: event_dedupe_key required", () => {
    assert.match(deliveryTableBlock(), /event_dedupe_key TEXT NOT NULL/);
  });

  it("15: event_dedupe_key nonblank", () => {
    assert.match(deliveryTableBlock(), /LENGTH\(TRIM\(event_dedupe_key\)\) > 0/);
  });

  it("16: event_dedupe_key UNIQUE", () => {
    assert.match(
      migrationSql(),
      /uq_mail_delivery_events_event_dedupe_key[\s\S]*?event_dedupe_key/,
    );
  });

  it("17: provider_event_id nullable", () => {
    assert.match(deliveryTableBlock(), /provider_event_id TEXT/);
    assert.doesNotMatch(
      deliveryTableBlock(),
      /provider_event_id TEXT NOT NULL/,
    );
  });

  it("18: provider_event_id not globally UNIQUE", () => {
    const sql = migrationSql();
    const uniqueIndexes = sql.match(/CREATE UNIQUE INDEX[^;]+;/g) ?? [];
    for (const idx of uniqueIndexes) {
      assert.doesNotMatch(idx, /provider_event_id/);
    }
    assert.match(sql, /NOT globally UNIQUE/i);
    assert.match(
      sql,
      /idx_mail_delivery_events_provider_event_id[\s\S]*provider_event_id/,
    );
  });

  it("19: provider_occurred_at nullable", () => {
    assert.match(deliveryTableBlock(), /provider_occurred_at TEXT/);
    assert.doesNotMatch(
      deliveryTableBlock(),
      /provider_occurred_at TEXT NOT NULL/,
    );
  });

  it("20: received_at required", () => {
    assert.match(deliveryTableBlock(), /received_at TEXT NOT NULL/);
  });

  it("21: no occurred_at <= received_at CHECK", () => {
    assert.doesNotMatch(deliveryTableBlock(), /provider_occurred_at <= received_at/i);
    assert.doesNotMatch(deliveryTableBlock(), /provider_occurred_at < received_at/i);
    assert.match(
      migrationSql(),
      /Do NOT require provider_occurred_at to precede received_at chronologically/i,
    );
  });

  it("22: multiple events per same recipient allowed", () => {
    assert.match(migrationSql(), /Multiple historical events required/i);
    assert.doesNotMatch(
      migrationSql(),
      /CREATE UNIQUE INDEX[\s\S]*?\(\s*send_operation_id,\s*outbound_revision_recipient_id\s*\)/,
    );
  });

  it("23: no recipient-level one-event UNIQUE", () => {
    const sql = migrationSql();
    assert.doesNotMatch(
      sql,
      /UNIQUE INDEX[\s\S]*outbound_revision_recipient_id[\s\S]*\) WHERE/,
    );
    assert.doesNotMatch(
      sql,
      /UNIQUE \(send_operation_id, outbound_revision_recipient_id\)/i,
    );
  });

  it("24: deferred may repeat", () => {
    assert.match(migrationSql(), /multiple deferred events before delivered or bounced/i);
  });

  it("25: delivered/bounced terminality documented as projection semantics only", () => {
    const sql = migrationSql();
    assert.match(sql, /terminal recipient outcomes for future current-state projection/i);
    assert.match(sql, /Do NOT reject later-arriving historical/i);
    assert.match(sql, /Future projection service determines/i);
  });

  it("26: out-of-order event handling documented", () => {
    const sql = migrationSql();
    assert.match(sql, /OUT-OF-ORDER EVENTS/i);
    assert.match(sql, /late, duplicated, out of chronological order/i);
    assert.match(sql, /WITHOUT deleting historical events/i);
  });

  it("27: accepted Transport Attempt service precondition documented", () => {
    const sql = migrationSql();
    assert.match(sql, /transport_attempt\.state MUST be accepted/i);
    assert.match(sql, /SECURITY\/INTEGRITY service invariant/i);
    assert.match(sql, /Do NOT create triggers/i);
  });

  it("28: unmatched webhook must not guess provenance", () => {
    const sql = migrationSql();
    assert.match(sql, /Unmatched[\s\S]*must NOT be inserted with guessed provenance/i);
    assert.match(sql, /separate quarantine\/inbox domain/i);
  });

  it("29: no raw provider payload/secrets columns", () => {
    const block = deliveryTableBlock();
    for (const forbidden of [
      "raw_payload",
      "webhook_payload",
      "response_blob",
      "auth_header",
      "secret",
      "token",
      "api_key",
    ]) {
      assert.doesNotMatch(block, new RegExp(forbidden, "i"));
    }
    assert.match(migrationSql(), /No raw webhook JSON/i);
  });

  it("30: diagnostic fields nullable", () => {
    const block = deliveryTableBlock();
    assert.match(block, /smtp_status_code TEXT/);
    assert.match(block, /smtp_enhanced_status_code TEXT/);
    assert.match(block, /diagnostic_message TEXT/);
    assert.doesNotMatch(block, /smtp_status_code TEXT NOT NULL/);
  });

  it("31: no CASCADE", () => {
    assert.doesNotMatch(deliveryTableBlock(), /ON DELETE CASCADE/i);
    assert.match(migrationSql(), /No CASCADE deletes/i);
  });

  it("32: Bcc privacy boundary documented", () => {
    const sql = migrationSql();
    assert.match(sql, /BCC PRIVACY/i);
    assert.match(sql, /preserve Bcc authorization rules/i);
    assert.match(sql, /Do NOT duplicate Bcc/i);
  });

  it("33: no current-status projection table", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /CREATE TABLE mail_delivery_status/);
    assert.doesNotMatch(sql, /CREATE TABLE mail_delivery_current/);
    assert.doesNotMatch(deliveryTableBlock(), /current_status/);
    assert.doesNotMatch(deliveryTableBlock(), /is_delivered/);
    assert.doesNotMatch(deliveryTableBlock(), /latest_event_type/);
    assert.match(sql, /No mutable "current delivery status" here/i);
  });

  it("34: no Delivery fields added to Send/Transport", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /ALTER TABLE mail_send_operations ADD/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_transport_attempts ADD/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_outbound_approvals ADD/);
    for (const status of MAIL_SEND_OPERATION_STATUSES) {
      if (status === "accepted") continue;
      assert.doesNotMatch(
        deliveryTableBlock(),
        new RegExp(`delivered.*${status}|${status}.*delivered`, "i"),
      );
    }
    assert.doesNotMatch(
      deliveryTableBlock(),
      new RegExp(MAIL_TRANSPORT_ATTEMPT_STATES.join("|")),
    );
  });

  it("35: 0052–0057 unchanged", () => {
    const m58 = migrationSql();
    assert.doesNotMatch(m58, /0059/);
    for (const frozen of FROZEN_MIGRATIONS) {
      const sql = frozenMigrationSql(frozen);
      assert.doesNotMatch(sql, /CREATE TABLE mail_delivery_events/);
      assert.doesNotMatch(sql, /mail_delivery_events/);
    }
    const mtimes = FROZEN_MIGRATIONS.map((f) =>
      statSync(join(process.cwd(), "drizzle/migrations", f)).mtimeMs,
    );
    assert.ok(mtimes.length === FROZEN_MIGRATIONS.length);
  });

  it("36: no D1 access", () => {
    assert.doesNotMatch(migrationSql(), /wrangler d1 execute/i);
    assert.doesNotMatch(migrationSql(), /env\.DB\.batch/);
    assert.doesNotMatch(migrationSql(), /getPlatformProxy/);
  });
});

describe("mail delivery event SQL ↔ Drizzle parity (2B.14 static)", () => {
  it("delivery event Drizzle exports align with migration", () => {
    const block = deliveryTableBlock();
    for (const col of [
      "send_operation_id",
      "transport_attempt_id",
      "outbound_revision_id",
      "outbound_revision_recipient_id",
      "event_type",
      "event_dedupe_key",
      "provider_event_id",
      "provider_occurred_at",
      "received_at",
      "smtp_status_code",
      "smtp_enhanced_status_code",
      "diagnostic_message",
    ]) {
      assert.match(block, new RegExp(col));
    }
    assert.doesNotMatch(block, /updated_at/);
  });

  it("state owner boundary documented", () => {
    const sql = migrationSql();
    assert.match(sql, /SEND accepted != delivered/i);
    assert.match(sql, /TRANSPORT accepted != delivered/i);
    assert.match(sql, /DELIVERY IS PER RECIPIENT/i);
  });

  it("provider_message_id not duplicated on Delivery Event", () => {
    assert.doesNotMatch(deliveryTableBlock(), /provider_message_id/);
    assert.match(
      migrationSql(),
      /preferred source of truth is mail_transport_attempts\.provider_message_id/i,
    );
  });

  it("future materialization boundary documented", () => {
    assert.match(migrationSql(), /Future materialization/i);
    assert.match(migrationSql(), /mail_messages is separate/i);
  });
});
