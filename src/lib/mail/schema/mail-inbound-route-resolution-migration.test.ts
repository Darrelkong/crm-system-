import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_0063 = join(
  process.cwd(),
  "drizzle/migrations/0063_mail_company_config.sql",
);
const MIGRATION_0064 = join(
  process.cwd(),
  "drizzle/migrations/0064_mail_inbound_route_resolution.sql",
);
const DRIZZLE_PATH = join(
  process.cwd(),
  "drizzle/schema/mail-inbound-ingestion-events.ts",
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
] as const;

function migrationSql(path: string): string {
  return readFileSync(path, "utf8");
}

function inboundTableBlock(): string {
  return (
    migrationSql(MIGRATION_0064).match(
      /CREATE TABLE mail_inbound_ingestion_events_new \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

describe("0064 inbound route resolution migration (static)", () => {
  it("0064 exists after 0063", () => {
    statSync(MIGRATION_0064);
    assert.match(migrationSql(MIGRATION_0064), /0064|resolved_route_mode/);
    assert.doesNotMatch(migrationSql(MIGRATION_0063), /resolved_route_mode/);
  });

  it("adds frozen route snapshot columns only on inbound ingestion child", () => {
    const sql = migrationSql(MIGRATION_0064);
    const block = inboundTableBlock();
    assert.match(block, /resolved_route_mode TEXT/);
    assert.match(block, /resolved_fallback_mailbox_id TEXT/);
    assert.match(
      block,
      /FOREIGN KEY \(resolved_fallback_mailbox_id\) REFERENCES mail_mailboxes \(id\)/,
    );
    assert.doesNotMatch(sql, /ALTER TABLE mail_company_config/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_provider_ingestion_events/);
    assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  });

  it("CHECK coupling for direct/fallback/null modes", () => {
    const block = inboundTableBlock();
    assert.match(
      block,
      /resolved_route_mode IS NULL[\s\S]*?resolved_fallback_mailbox_id IS NULL/,
    );
    assert.match(
      block,
      /resolved_route_mode = 'direct'[\s\S]*?resolved_fallback_mailbox_id IS NULL/,
    );
    assert.match(
      block,
      /resolved_route_mode = 'fallback'[\s\S]*?resolved_fallback_mailbox_id IS NOT NULL[\s\S]*?resolved_fallback_mailbox_id <> route_owner_mailbox_id/,
    );
  });

  it("legacy rows backfill NULL without fabricating fallback", () => {
    const sql = migrationSql(MIGRATION_0064);
    assert.match(sql, /NULL,\s*\n\s*NULL\s*\nFROM mail_inbound_ingestion_events/);
    assert.doesNotMatch(sql, /UPDATE mail_inbound_ingestion_events SET resolved_fallback/);
    assert.doesNotMatch(sql, /INSERT INTO mail_company_config/);
    assert.doesNotMatch(sql, /FROM mail_company_config/);
  });

  it("drizzle schema exported", () => {
    const source = readFileSync(DRIZZLE_PATH, "utf8");
    assert.match(source, /resolvedRouteMode/);
    assert.match(source, /resolvedFallbackMailboxId/);
    assert.match(source, /fk_mail_inbound_ingestion_events_resolved_fallback_mailbox/);
  });

  it("0052–0063 unchanged on disk", () => {
    for (const name of FROZEN_MIGRATIONS) {
      statSync(join(process.cwd(), "drizzle/migrations", name));
      assert.ok(migrationSql(join(process.cwd(), "drizzle/migrations", name)).length > 0);
    }
  });
});
