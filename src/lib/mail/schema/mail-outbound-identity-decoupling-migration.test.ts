import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_0067 = join(
  process.cwd(),
  "drizzle/migrations/0067_mail_outbound_identity_decoupling.sql",
);
const MIGRATION_0066 = join(
  process.cwd(),
  "drizzle/migrations/0066_mail_notification_outbox.sql",
);
const MIGRATION_0059 = join(
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
  "0059_mail_outbound_materialization.sql",
  "0060_mail_receiving_address.sql",
  "0061_mail_provider_ingestion.sql",
  "0062_mail_approval_review_permission.sql",
  "0063_mail_company_config.sql",
  "0064_mail_inbound_route_resolution.sql",
  "0065_mail_provider_ingestion_processing_lease.sql",
  "0066_mail_notification_outbox.sql",
] as const;

function migrationSql(path: string): string {
  return readFileSync(path, "utf8");
}

function matTableBlock(sql: string): string {
  return (
    sql.match(
      /CREATE TABLE mail_outbound_message_materializations_new \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

describe("0067 outbound identity decoupling migration (static)", () => {
  it("1: migration exists and is 0067", () => {
    statSync(MIGRATION_0067);
    assert.match(migrationSql(MIGRATION_0067), /0067|outbound identity decoupling/i);
    assert.doesNotMatch(migrationSql(MIGRATION_0066), /wire_internet_message_id/);
  });

  it("2: 0052–0066 files unchanged by 0067 content", () => {
    const sql = migrationSql(MIGRATION_0067);
    assert.doesNotMatch(sql, /ALTER TABLE mail_outbound_rfc_identities/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_transport_attempts/);
    for (const name of FROZEN_MIGRATIONS) {
      assert.ok(
        readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8").length > 0,
        `${name} must exist`,
      );
    }
  });

  it("3: materialization table rebuilt", () => {
    const sql = migrationSql(MIGRATION_0067);
    assert.match(sql, /mail_outbound_message_materializations_new/);
    assert.match(sql, /DROP TABLE mail_outbound_message_materializations/);
    assert.match(sql, /RENAME TO mail_outbound_message_materializations/);
  });

  it("4: wire_internet_message_id exists and is nullable", () => {
    const block = matTableBlock(migrationSql(MIGRATION_0067));
    assert.match(block, /wire_internet_message_id TEXT/);
    assert.doesNotMatch(block, /wire_internet_message_id TEXT NOT NULL/);
  });

  it("5: rfc_message_id remains NOT NULL", () => {
    assert.match(matTableBlock(migrationSql(MIGRATION_0067)), /rfc_message_id TEXT NOT NULL/);
  });

  it("6: old rfc==wire FK removed", () => {
    const sql = migrationSql(MIGRATION_0067);
    const block = matTableBlock(sql);
    assert.doesNotMatch(
      block,
      /FOREIGN KEY \(\s*mail_message_id,\s*rfc_message_id,\s*message_direction\s*\)/,
    );
    assert.doesNotMatch(
      block,
      /mail_message_id,\s*rfc_message_id,\s*message_direction[\s\S]*?internet_message_id/,
    );
    const m59 = migrationSql(MIGRATION_0059);
    assert.match(
      m59,
      /FOREIGN KEY \(\s*mail_message_id,\s*rfc_message_id,\s*message_direction\s*\)/,
    );
  });

  it("7: new wire composite FK exists", () => {
    const block = matTableBlock(migrationSql(MIGRATION_0067));
    assert.match(
      block,
      /FOREIGN KEY \(\s*mail_message_id,\s*wire_internet_message_id,\s*message_direction\s*\)/,
    );
    assert.match(
      block,
      /REFERENCES mail_messages \(\s*id,\s*internet_message_id,\s*direction\s*\)/,
    );
  });

  it("8: always-on mail_message direction FK exists", () => {
    const sql = migrationSql(MIGRATION_0067);
    assert.match(sql, /uq_mail_messages_id_direction/);
    assert.match(
      matTableBlock(sql),
      /FOREIGN KEY \(\s*mail_message_id,\s*message_direction\s*\)/,
    );
    assert.match(
      matTableBlock(sql),
      /REFERENCES mail_messages \(\s*id,\s*direction\s*\)/,
    );
  });

  it("9–12: wire CHECK and legacy copy documented", () => {
    const sql = migrationSql(MIGRATION_0067);
    assert.match(sql, /wire_internet_message_id IS NULL[\s\S]*?LENGTH\(TRIM\(wire_internet_message_id\)\)/);
    assert.match(sql, /NULL AS wire_internet_message_id/);
    assert.match(sql, /INTERNAL client-stable message identity/i);
    assert.doesNotMatch(sql, /rfc_message_id AS wire_internet_message_id/);
  });

  it("13–14: internal rfc distinct from wire/provider documented", () => {
    const sql = migrationSql(MIGRATION_0067);
    assert.match(sql, /Do NOT require:/i);
    assert.match(sql, /provider_message_id == wire_internet_message_id/i);
    assert.doesNotMatch(matTableBlock(sql), /provider_message_id/);
  });

  it("15–16: one materialization per send and one message per materialization", () => {
    const sql = migrationSql(MIGRATION_0067);
    assert.match(sql, /uq_mail_outbound_message_materializations_send_operation_id/);
    assert.match(sql, /uq_mail_outbound_message_materializations_mail_message_id/);
  });

  it("17–18: accepted attempt and rfc identity provenance preserved", () => {
    const block = matTableBlock(migrationSql(MIGRATION_0067));
    assert.match(
      block,
      /FOREIGN KEY \(\s*accepted_transport_attempt_id,\s*send_operation_id\s*\)/,
    );
    assert.match(
      block,
      /FOREIGN KEY \(\s*outbound_rfc_identity_id,\s*send_operation_id,\s*rfc_message_id\s*\)/,
    );
  });

  it("19: no CASCADE", () => {
    assert.doesNotMatch(migrationSql(MIGRATION_0067), /ON DELETE CASCADE/i);
  });

  it("20: PRAGMA foreign_keys toggled", () => {
    const sql = migrationSql(MIGRATION_0067);
    assert.match(sql, /PRAGMA foreign_keys = OFF/);
    assert.match(sql, /PRAGMA foreign_keys = ON/);
  });
});
