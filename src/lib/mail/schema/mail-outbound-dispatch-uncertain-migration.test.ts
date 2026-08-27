import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_SEND_OPERATION_STATUSES,
} from "../../../../drizzle/schema/mail-send-operations";
import { MAIL_TRANSPORT_ATTEMPT_STATES } from "../../../../drizzle/schema/mail-transport-attempts";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0068_mail_outbound_dispatch_uncertain.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("mail outbound dispatch uncertain migration (2H-6N.1C static)", () => {
  it("1: migration file exists", () => {
    assert.match(migrationSql(), /Phase 2H-6N\.1C/);
    assert.match(MIGRATION_PATH, /0068_mail_outbound_dispatch_uncertain\.sql$/);
  });

  it("2: extends send operation status CHECK with dispatch_uncertain", () => {
    assert.match(migrationSql(), /dispatch_uncertain/);
    assert.ok(MAIL_SEND_OPERATION_STATUSES.includes("dispatch_uncertain"));
  });

  it("3: extends transport attempt state CHECK with ambiguous", () => {
    assert.match(migrationSql(), /'ambiguous'/);
    assert.ok(MAIL_TRANSPORT_ATTEMPT_STATES.includes("ambiguous"));
  });

  it("4: dispatch_uncertain requires completed_at and null next_attempt_at", () => {
    assert.match(
      migrationSql(),
      /status = 'dispatch_uncertain'[\s\S]*?completed_at IS NOT NULL[\s\S]*?next_attempt_at IS NULL/,
    );
  });

  it("5: ambiguous attempt requires completed_at", () => {
    assert.match(
      migrationSql(),
      /state IN \([\s\S]*?'ambiguous'[\s\S]*?\)[\s\S]*?completed_at IS NOT NULL/,
    );
  });

  it("6: preserves started partial UNIQUE — ambiguous excluded", () => {
    assert.match(
      migrationSql(),
      /uq_mail_transport_attempts_one_started_per_send_operation[\s\S]*?WHERE state = 'started'/,
    );
    assert.doesNotMatch(
      migrationSql(),
      /WHERE state IN \('started', 'ambiguous'\)/,
    );
  });

  it("7: uses D1-compatible defer_foreign_keys rebuild pattern", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /PRAGMA\s+foreign_keys\s*=\s*OFF/i);
    assert.match(sql, /PRAGMA\s+defer_foreign_keys\s*=\s*ON/i);
    assert.match(sql, /CREATE TABLE mail_send_operations_new/);
    assert.match(sql, /CREATE TABLE mail_delivery_events_new/);
    assert.match(sql, /CREATE TABLE mail_delivery_event_materializations_new/);
    assert.match(sql, /DROP TABLE mail_delivery_event_materializations/);
    assert.match(sql, /ALTER TABLE mail_send_operations_new RENAME TO mail_send_operations/);
  });

  it("8: recreates transport and send indexes", () => {
    const sql = migrationSql();
    for (const index of [
      "uq_mail_transport_attempts_send_operation_attempt_number",
      "uq_mail_transport_attempts_one_started_per_send_operation",
      "uq_mail_send_operations_outbound_revision_id",
      "uq_mail_send_operations_idempotency_key",
      "uq_mail_send_operations_id_outbound_revision_id",
      "uq_mail_delivery_events_id_event_type",
      "uq_mail_delivery_event_materializations_ingestion_event_id",
    ]) {
      assert.match(sql, new RegExp(index));
    }
  });
});
