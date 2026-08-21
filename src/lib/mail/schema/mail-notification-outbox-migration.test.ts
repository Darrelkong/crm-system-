import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_0065 = join(
  process.cwd(),
  "drizzle/migrations/0065_mail_provider_ingestion_processing_lease.sql",
);
const MIGRATION_0066 = join(
  process.cwd(),
  "drizzle/migrations/0066_mail_notification_outbox.sql",
);
const OUTBOX_DRIZZLE = join(
  process.cwd(),
  "drizzle/schema/mail-notification-outbox.ts",
);
const ATTEMPTS_DRIZZLE = join(
  process.cwd(),
  "drizzle/schema/mail-notification-attempts.ts",
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
] as const;

function migrationSql(path: string): string {
  return readFileSync(path, "utf8");
}

function outboxTableBlock(): string {
  return (
    migrationSql(MIGRATION_0066).match(
      /CREATE TABLE mail_notification_outbox \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function attemptsTableBlock(): string {
  return (
    migrationSql(MIGRATION_0066).match(
      /CREATE TABLE mail_notification_attempts \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

describe("0066 notification outbox migration (static)", () => {
  it("0066 exists after 0065", () => {
    statSync(MIGRATION_0066);
    assert.doesNotMatch(
      migrationSql(MIGRATION_0065),
      /mail_notification_outbox/,
    );
  });

  it("0052–0065 frozen on disk", () => {
    for (const name of FROZEN_MIGRATIONS) {
      statSync(join(process.cwd(), "drizzle/migrations", name));
    }
    assert.doesNotMatch(migrationSql(MIGRATION_0066), /ALTER TABLE mail_messages/);
    assert.doesNotMatch(migrationSql(MIGRATION_0066), /ON DELETE CASCADE/);
  });

  it("outbox notification types and statuses", () => {
    const block = outboxTableBlock();
    assert.match(block, /new_incoming/);
    assert.match(block, /approval_returned/);
    assert.match(block, /shared_assigned/);
    assert.match(block, /important_send_failure/);
    assert.match(block, /failed_retryable/);
    assert.match(block, /failed_permanent/);
  });

  it("outbox status CHECK coupling", () => {
    const block = outboxTableBlock();
    assert.match(block, /status = 'pending'[\s\S]*?next_attempt_at IS NULL/);
    assert.match(
      block,
      /status = 'processing'[\s\S]*?processing_lease_expires_at > processing_started_at/,
    );
    assert.match(
      block,
      /status = 'failed_retryable'[\s\S]*?next_attempt_at IS NOT NULL/,
    );
    assert.match(block, /status = 'sent'[\s\S]*?completed_at IS NOT NULL/);
    assert.match(
      block,
      /status = 'failed_permanent'[\s\S]*?failure_code IS NOT NULL/,
    );
  });

  it("semantic idempotency unique index", () => {
    const sql = migrationSql(MIGRATION_0066);
    assert.match(sql, /uq_mail_notification_outbox_semantic_dedupe/);
    assert.match(
      sql,
      /notification_type,\s*source_entity_type,\s*source_entity_id,\s*recipient_user_id/,
    );
  });

  it("attempt states include outcome_unknown", () => {
    const block = attemptsTableBlock();
    assert.match(block, /outcome_unknown/);
    assert.match(block, /error_code = 'transport_outcome_unknown'/);
  });

  it("attempt uniqueness indexes", () => {
    const sql = migrationSql(MIGRATION_0066);
    assert.match(sql, /uq_mail_notification_attempts_outbox_attempt_number/);
    assert.match(sql, /uq_mail_notification_attempts_one_started_per_outbox/);
    assert.match(sql, /WHERE state = 'started'/);
  });

  it("drizzle schema files export tables", () => {
    assert.match(readFileSync(OUTBOX_DRIZZLE, "utf8"), /mailNotificationOutbox/);
    assert.match(
      readFileSync(ATTEMPTS_DRIZZLE, "utf8"),
      /mailNotificationAttempts/,
    );
  });

  it("no attempt_count denormalized column", () => {
    assert.doesNotMatch(outboxTableBlock(), /attempt_count/);
  });
});
