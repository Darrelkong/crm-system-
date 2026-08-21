import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_0064 = join(
  process.cwd(),
  "drizzle/migrations/0064_mail_inbound_route_resolution.sql",
);
const MIGRATION_0065 = join(
  process.cwd(),
  "drizzle/migrations/0065_mail_provider_ingestion_processing_lease.sql",
);
const DRIZZLE_PATH = join(
  process.cwd(),
  "drizzle/schema/mail-provider-ingestion-events.ts",
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
] as const;

function migrationSql(path: string): string {
  return readFileSync(path, "utf8");
}

function providerTableBlock(): string {
  return (
    migrationSql(MIGRATION_0065).match(
      /CREATE TABLE mail_provider_ingestion_events_new \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

describe("0065 provider ingestion processing lease migration (static)", () => {
  it("0065 exists after 0064", () => {
    statSync(MIGRATION_0065);
    assert.match(
      migrationSql(MIGRATION_0065),
      /0065|processing_lease_expires_at/,
    );
    assert.doesNotMatch(
      migrationSql(MIGRATION_0064),
      /processing_lease_expires_at/,
    );
  });

  it("adds processing lease columns only on provider ingestion", () => {
    const sql = migrationSql(MIGRATION_0065);
    const block = providerTableBlock();
    assert.match(block, /processing_started_at TEXT/);
    assert.match(block, /processing_lease_expires_at TEXT/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_inbound_ingestion_events/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_delivery_ingestion_events/);
    assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  });

  it("rejects partial lease globally", () => {
    const block = providerTableBlock();
    assert.match(
      block,
      /processing_started_at IS NULL AND processing_lease_expires_at IS NOT NULL/,
    );
    assert.match(
      block,
      /processing_started_at IS NOT NULL AND processing_lease_expires_at IS NULL/,
    );
  });

  it("non-processing states require NULL lease fields", () => {
    const block = providerTableBlock();
    assert.match(
      block,
      /status = 'pending'[\s\S]*?processing_started_at IS NULL[\s\S]*?processing_lease_expires_at IS NULL/,
    );
    assert.match(
      block,
      /status = 'completed'[\s\S]*?processing_started_at IS NULL[\s\S]*?processing_lease_expires_at IS NULL/,
    );
    assert.match(
      block,
      /status = 'quarantined'[\s\S]*?processing_started_at IS NULL[\s\S]*?processing_lease_expires_at IS NULL/,
    );
  });

  it("processing allows legacy unleased OR active leased pair", () => {
    const block = providerTableBlock();
    assert.match(
      block,
      /status = 'processing'[\s\S]*?processing_started_at IS NULL AND processing_lease_expires_at IS NULL/,
    );
    assert.match(
      block,
      /processing_lease_expires_at > processing_started_at/,
    );
  });

  it("legacy backfill NULL without fabricating lease", () => {
    const sql = migrationSql(MIGRATION_0065);
    assert.match(sql, /NULL,\s*\n\s*NULL\s*\nFROM mail_provider_ingestion_events/);
    assert.doesNotMatch(sql, /UPDATE mail_provider_ingestion_events SET processing_/);
  });

  it("adds lease expiry index", () => {
    assert.match(
      migrationSql(MIGRATION_0065),
      /idx_mail_provider_ingestion_events_status_lease_expires/,
    );
  });

  it("drizzle schema exported", () => {
    const source = readFileSync(DRIZZLE_PATH, "utf8");
    assert.match(source, /processingStartedAt/);
    assert.match(source, /processingLeaseExpiresAt/);
    assert.match(source, /idx_mail_provider_ingestion_events_status_lease_expires/);
  });

  it("0052–0064 unchanged on disk", () => {
    for (const name of FROZEN_MIGRATIONS) {
      statSync(join(process.cwd(), "drizzle/migrations", name));
      assert.ok(migrationSql(join(process.cwd(), "drizzle/migrations", name)).length > 0);
    }
    assert.doesNotMatch(migrationSql(MIGRATION_0065), /0066/);
  });
});
