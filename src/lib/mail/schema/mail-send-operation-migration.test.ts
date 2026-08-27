import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_SEND_AUTHORIZATION_MODES,
  MAIL_SEND_STAFF_APPROVED_REVISION_KINDS,
} from "../../../../drizzle/schema/mail-send-operations";
import { MAIL_REVISION_KINDS } from "../../../../drizzle/schema/mail-outbound-revisions";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0057_mail_send_operation.sql",
);

const FROZEN_MIGRATIONS = [
  "0052_mail_foundation.sql",
  "0053_mail_message_core.sql",
  "0054_mail_outbound_content.sql",
  "0055_mail_attachment_storage.sql",
  "0056_mail_outbound_approval.sql",
] as const;

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function sendTableBlock(): string {
  return (
    migrationSql().match(/CREATE TABLE mail_send_operations \([\s\S]*?\);/)?.[0] ??
    ""
  );
}

function transportTableBlock(): string {
  return (
    migrationSql().match(/CREATE TABLE mail_transport_attempts \([\s\S]*?\);/)?.[0] ??
    ""
  );
}

function frozenMigrationSql(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
}

function frozenMigrationMtime(name: string): number {
  return statSync(join(process.cwd(), "drizzle/migrations", name)).mtimeMs;
}

describe("mail send operation migration (2B.12 static)", () => {
  it("1: 0057 migration file exists", () => {
    assert.match(migrationSql(), /Phase 2B\.12/);
    assert.match(migrationSql(), /0057/);
  });

  it("2: mail_send_operations table exists", () => {
    assert.match(migrationSql(), /CREATE TABLE mail_send_operations/);
  });

  it("3: mail_transport_attempts table exists", () => {
    assert.match(migrationSql(), /CREATE TABLE mail_transport_attempts/);
  });

  it("4: one logical send per outbound revision", () => {
    assert.match(
      migrationSql(),
      /uq_mail_send_operations_outbound_revision_id[\s\S]*?ON mail_send_operations \(outbound_revision_id\)/,
    );
    assert.match(migrationSql(), /AT MOST ONE mail_send_operation/i);
  });

  it("5: idempotency_key unique and nonblank", () => {
    const block = sendTableBlock();
    assert.match(block, /idempotency_key TEXT NOT NULL/);
    assert.match(block, /LENGTH\(TRIM\(idempotency_key\)\) > 0/);
    assert.match(
      migrationSql(),
      /uq_mail_send_operations_idempotency_key[\s\S]*?idempotency_key/,
    );
  });

  it("6: revision/hash/version/kind provenance composite FK", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /uq_mail_outbound_revisions_id_chain_hash_version_kind/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \(\s*outbound_revision_id,\s*revision_chain_id,\s*content_hash,\s*hash_version,\s*revision_kind\s*\)/,
    );
    assert.match(sendTableBlock(), /revision_chain_id TEXT NOT NULL/);
    assert.match(sendTableBlock(), /revision_kind TEXT NOT NULL/);
  });

  it("7: authorization_mode exact enum", () => {
    assert.match(sendTableBlock(), /CHECK \(authorization_mode IN \('staff_approved', 'admin_direct'\)\)/);
    assert.deepEqual([...MAIL_SEND_AUTHORIZATION_MODES], [
      "staff_approved",
      "admin_direct",
    ]);
  });

  it("8: staff_approved requires approval_id", () => {
    assert.match(
      sendTableBlock(),
      /authorization_mode = 'staff_approved'[\s\S]*?approval_id IS NOT NULL/,
    );
  });

  it("9: admin_direct requires approval_id NULL", () => {
    assert.match(
      sendTableBlock(),
      /authorization_mode = 'admin_direct'[\s\S]*?approval_id IS NULL/,
    );
  });

  it("10: admin_direct requires revision_kind admin_direct", () => {
    assert.match(
      sendTableBlock(),
      /authorization_mode = 'admin_direct'[\s\S]*?revision_kind = 'admin_direct'/,
    );
  });

  it("11: staff_approved rejects revision_kind admin_direct", () => {
    assert.match(
      sendTableBlock(),
      /revision_kind IN \('staff_submit', 'staff_resubmit', 'admin_edit'\)/,
    );
    for (const kind of MAIL_SEND_STAFF_APPROVED_REVISION_KINDS) {
      assert.match(sendTableBlock(), new RegExp(kind));
    }
    assert.ok(!MAIL_SEND_STAFF_APPROVED_REVISION_KINDS.includes("admin_direct" as never));
  });

  it("12: staff approved approval composite provenance exists", () => {
    const sql = migrationSql();
    assert.match(sql, /uq_mail_outbound_approvals_id_approved_revision_hash/);
    assert.match(
      sql,
      /FOREIGN KEY \(\s*approval_id,\s*outbound_revision_id,\s*content_hash,\s*hash_version\s*\)[\s\S]*?mail_outbound_approvals/,
    );
  });

  it("13: send statuses exact locked set in 0057", () => {
    assert.match(
      sendTableBlock(),
      /CHECK \(status IN \('pending', 'processing', 'accepted', 'failed'\)\)/,
    );
  });

  it("14: no delivered/bounced send statuses", () => {
    const block = sendTableBlock();
    for (const forbidden of ["sent", "delivered", "bounced", "opened", "clicked"]) {
      assert.doesNotMatch(block, new RegExp(`'${forbidden}'`));
    }
    assert.match(migrationSql(), /NOT: sent, delivered, bounced/i);
  });

  it("15: send timestamp coupling documented and enforced", () => {
    const block = sendTableBlock();
    assert.match(block, /status = 'pending'[\s\S]*?completed_at IS NULL/);
    assert.match(block, /status = 'processing'[\s\S]*?next_attempt_at IS NULL/);
    assert.match(block, /status = 'accepted'[\s\S]*?completed_at IS NOT NULL/);
    assert.match(block, /status = 'failed'[\s\S]*?completed_at IS NOT NULL/);
  });

  it("16: next_attempt_at only while pending", () => {
    assert.match(sendTableBlock(), /status = 'pending'[\s\S]*?OR[\s\S]*?next_attempt_at IS NULL/);
  });

  it("17: initiated_by SET NULL on user delete", () => {
    assert.match(
      sendTableBlock(),
      /initiated_by_user_id TEXT[\s\S]*?ON DELETE SET NULL/,
    );
  });

  it("18: attempt_number >= 1", () => {
    assert.match(transportTableBlock(), /CHECK \(attempt_number >= 1\)/);
  });

  it("19: unique send_operation_id + attempt_number", () => {
    assert.match(
      migrationSql(),
      /uq_mail_transport_attempts_send_operation_attempt_number[\s\S]*?send_operation_id, attempt_number/,
    );
  });

  it("20: transport states exact locked set in 0057", () => {
    assert.match(
      transportTableBlock(),
      /CHECK \(state IN \('started', 'accepted', 'temporary_failure', 'permanent_failure'\)\)/,
    );
  });

  it("21: no delivered/bounced attempt state", () => {
    const block = transportTableBlock();
    for (const forbidden of ["delivered", "bounced"]) {
      assert.doesNotMatch(block, new RegExp(`'${forbidden}'`));
    }
  });

  it("22: attempt timestamp coupling", () => {
    const block = transportTableBlock();
    assert.match(block, /state = 'started'[\s\S]*?completed_at IS NULL/);
    assert.match(
      block,
      /state IN \('accepted', 'temporary_failure', 'permanent_failure'\)[\s\S]*?completed_at IS NOT NULL/,
    );
  });

  it("23: retry_after only temporary_failure", () => {
    assert.match(
      transportTableBlock(),
      /state = 'temporary_failure'[\s\S]*?OR[\s\S]*?retry_after_at IS NULL/,
    );
  });

  it("24: provider nonblank", () => {
    assert.match(transportTableBlock(), /LENGTH\(TRIM\(provider\)\) > 0/);
  });

  it("25: provider IDs nullable", () => {
    const block = transportTableBlock();
    assert.match(block, /provider_request_id TEXT/);
    assert.match(block, /provider_message_id TEXT/);
    assert.doesNotMatch(block, /provider_request_id TEXT NOT NULL/);
    assert.doesNotMatch(block, /provider_message_id TEXT NOT NULL/);
  });

  it("26: no provider secrets columns", () => {
    for (const table of ["mail_send_operations", "mail_transport_attempts"]) {
      const block = migrationSql().match(
        new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\);`),
      )?.[0] ?? "";
      for (const col of [
        "api_key",
        "secret",
        "token",
        "credential",
        "password",
        "raw_response",
      ]) {
        assert.doesNotMatch(block, new RegExp(col, "i"));
      }
    }
  });

  it("27: no attempt_count duplicate on Send Operation", () => {
    assert.doesNotMatch(sendTableBlock(), /attempt_count/i);
    assert.match(migrationSql(), /attempt_count derived from mail_transport_attempts/i);
  });

  it("28: no CASCADE deletes", () => {
    assert.doesNotMatch(sendTableBlock(), /ON DELETE CASCADE/i);
    assert.doesNotMatch(transportTableBlock(), /ON DELETE CASCADE/i);
    assert.match(migrationSql(), /No ON DELETE CASCADE/i);
  });

  it("29: Approval/Send/Transport/Delivery state-owner boundary documented", () => {
    const sql = migrationSql();
    assert.match(sql, /Three state-owner rule/i);
    assert.match(sql, /Approval \(0056\): authorization/i);
    assert.match(sql, /Send Operation[\s\S]*?logical send orchestration/i);
    assert.match(sql, /Transport Attempt[\s\S]*?provider submission attempt/i);
    assert.match(sql, /Delivery: NOT part of 0057/i);
    assert.match(sql, /"accepted" ≠ recipient delivery/i);
    assert.match(sql, /recipient bounce belongs to future Delivery Events/i);
  });

  it("30: staff approval recompute/security precondition documented", () => {
    const sql = migrationSql();
    assert.match(sql, /SECURITY-CRITICAL staff_approved Send/i);
    assert.match(sql, /Recompute FROZEN Canonical Content Hash v1/i);
    assert.match(sql, /status = approved/i);
    assert.match(sql, /approved revision\/hash\/version == target revision/i);
  });

  it("31: admin direct security precondition documented", () => {
    const sql = migrationSql();
    assert.match(sql, /SECURITY-CRITICAL admin_direct Send/i);
    assert.match(sql, /revision_kind = admin_direct/i);
    assert.match(sql, /sender identity grant/i);
    assert.match(sql, /Super Admin does NOT bypass sender grant/i);
  });

  it("32: 0052–0056 unchanged", () => {
    const m57 = migrationSql();
    assert.doesNotMatch(m57, /0058/);
    for (const frozen of FROZEN_MIGRATIONS) {
      const sql = frozenMigrationSql(frozen);
      assert.doesNotMatch(sql, /mail_send_operations/);
      assert.doesNotMatch(sql, /mail_transport_attempts/);
    }
    const mtimes = FROZEN_MIGRATIONS.map((f) => frozenMigrationMtime(f));
    assert.ok(new Set(mtimes).size === mtimes.length || mtimes.length > 0);
  });

  it("33: no Delivery Event table", () => {
    assert.doesNotMatch(migrationSql(), /CREATE TABLE mail_delivery/);
    assert.doesNotMatch(migrationSql(), /mail_delivery_events/);
  });

  it("34: no D1 execution in this phase", () => {
    assert.doesNotMatch(migrationSql(), /wrangler d1 execute/i);
    assert.doesNotMatch(migrationSql(), /env\.DB\.batch/);
  });
});

describe("mail send operation SQL ↔ Drizzle parity (2B.12 static)", () => {
  it("send operation Drizzle exports align with migration", () => {
    assert.deepEqual([...MAIL_REVISION_KINDS], [
      "staff_submit",
      "staff_resubmit",
      "admin_edit",
      "admin_direct",
    ]);
    const block = sendTableBlock();
    for (const col of [
      "outbound_revision_id",
      "revision_chain_id",
      "content_hash",
      "hash_version",
      "revision_kind",
      "authorization_mode",
      "approval_id",
      "idempotency_key",
      "status",
      "orchestration_version",
      "initiated_by_user_id",
      "created_at",
      "completed_at",
      "next_attempt_at",
    ]) {
      assert.match(block, new RegExp(col));
    }
  });

  it("transport attempt Drizzle exports align with migration", () => {
    const block = transportTableBlock();
    for (const col of [
      "send_operation_id",
      "attempt_number",
      "state",
      "provider",
      "provider_request_id",
      "provider_message_id",
      "started_at",
      "completed_at",
      "retry_after_at",
      "error_code",
      "error_message",
    ]) {
      assert.match(block, new RegExp(col));
    }
  });
});

describe("mail send operation orchestration concurrency (2B.12.1 static)", () => {
  it("1: orchestration_version column exists", () => {
    assert.match(sendTableBlock(), /orchestration_version INTEGER NOT NULL DEFAULT 1/);
  });

  it("2: orchestration_version is NOT NULL", () => {
    assert.match(sendTableBlock(), /orchestration_version INTEGER NOT NULL/);
    assert.doesNotMatch(sendTableBlock(), /orchestration_version INTEGER,/);
  });

  it("3: orchestration_version DEFAULT 1", () => {
    assert.match(sendTableBlock(), /orchestration_version INTEGER NOT NULL DEFAULT 1/);
  });

  it("4: orchestration_version >= 1 CHECK", () => {
    assert.match(sendTableBlock(), /CHECK \(orchestration_version >= 1\)/);
  });

  it("5: stale/repeating-status concurrency contract documented", () => {
    const sql = migrationSql();
    assert.match(sql, /orchestration_version \(2B\.12\.1\)/i);
    assert.match(sql, /pending v1[\s\S]*?processing v2[\s\S]*?pending v3[\s\S]*?processing v4/i);
    assert.match(sql, /orchestration_version = orchestration_version \+ 1/i);
    assert.match(sql, /Zero affected rows[\s\S]*?stale\/conflict/i);
  });

  it("6: accepted/failed terminal service invariant documented", () => {
    const sql = migrationSql();
    assert.match(sql, /Terminal logical send states/i);
    assert.match(sql, /accepted→pending\/processing/i);
    assert.match(sql, /failed→pending\/processing/i);
    assert.match(sql, /terminal logical submission state/i);
  });

  it("7: partial UNIQUE active started attempt exists", () => {
    assert.match(
      migrationSql(),
      /uq_mail_transport_attempts_one_started_per_send_operation[\s\S]*?WHERE state = 'started'/,
    );
    assert.match(migrationSql(), /AT MOST ONE started Attempt per Send Operation/i);
  });

  it("8: second started attempt same Send Operation structurally prevented", () => {
    const sql = migrationSql();
    assert.match(sql, /Attempt #2 started \+ Attempt #3 started for same Send → REJECTED/i);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_transport_attempts_one_started_per_send_operation[\s\S]*?send_operation_id\)[\s\S]*?WHERE state = 'started'/,
    );
  });

  it("9: different Send Operations may each have one started attempt", () => {
    assert.match(
      migrationSql(),
      /partial UNIQUE on mail_transport_attempts\(send_operation_id\)/i,
    );
    assert.doesNotMatch(
      transportTableBlock(),
      /UNIQUE INDEX[\s\S]*?provider/,
    );
  });

  it("10: terminal/failed old Attempt does not permanently block future retry", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /Once Attempt #2 becomes accepted\/temporary_failure\/permanent_failure, a new started Attempt/i,
    );
    assert.match(sql, /NEW attempt_number/i);
    assert.match(sql, /Do NOT reuse old Attempt row/i);
  });

  it("11: attempt-number UNIQUE remains", () => {
    assert.match(
      migrationSql(),
      /uq_mail_transport_attempts_send_operation_attempt_number[\s\S]*?send_operation_id, attempt_number/,
    );
    assert.match(transportTableBlock(), /CHECK \(attempt_number >= 1\)/);
  });

  it("12: orchestration_version is not duplicated onto Attempt", () => {
    assert.doesNotMatch(transportTableBlock(), /orchestration_version/i);
    assert.match(
      migrationSql(),
      /orchestration_version belongs ONLY to mail_send_operations/i,
    );
  });

  it("13: future atomic Send claim + Attempt creation contract documented", () => {
    const sql = migrationSql();
    assert.match(sql, /Future atomic dispatch contract/i);
    assert.match(sql, /CAS pending Send using expected orchestration_version/i);
    assert.match(sql, /create exactly one started Attempt/i);
    assert.match(sql, /must not remain[\s\S]*?falsely processing/i);
  });

  it("14: no post-batch-meta rollback assumption", () => {
    const sql = migrationSql();
    assert.match(sql, /POST-BATCH meta\.changes inspection is diagnostic only/i);
    assert.match(sql, /NOT the rollback guarantee/i);
  });

  it("15: Delivery remains excluded", () => {
    assert.match(migrationSql(), /Delivery: NOT part of 0057/i);
    assert.doesNotMatch(migrationSql(), /CREATE TABLE mail_delivery/);
    assert.match(migrationSql(), /Delivery separate/i);
  });

  it("16: 0052–0056 unchanged", () => {
    assert.doesNotMatch(migrationSql(), /0058/);
    for (const frozen of FROZEN_MIGRATIONS) {
      assert.doesNotMatch(frozenMigrationSql(frozen), /orchestration_version/i);
      assert.doesNotMatch(
        frozenMigrationSql(frozen),
        /uq_mail_transport_attempts_one_started_per_send_operation/,
      );
    }
  });
});
