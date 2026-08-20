import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_0062 = join(
  process.cwd(),
  "drizzle/migrations/0062_mail_approval_review_permission.sql",
);
const MIGRATION_0063 = join(
  process.cwd(),
  "drizzle/migrations/0063_mail_company_config.sql",
);
const DRIZZLE_PATH = join(
  process.cwd(),
  "drizzle/schema/mail-company-config.ts",
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
] as const;

function migrationSql(path: string): string {
  return readFileSync(path, "utf8");
}

function companyConfigBlock(): string {
  return (
    migrationSql(MIGRATION_0063).match(
      /CREATE TABLE mail_company_config \([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

describe("0063 mail company config migration (static)", () => {
  it("0063 exists after 0062", () => {
    statSync(MIGRATION_0063);
    assert.match(migrationSql(MIGRATION_0063), /0063|mail_company_config/);
    assert.doesNotMatch(migrationSql(MIGRATION_0062), /mail_company_config/);
  });

  it("creates singleton mail_company_config only", () => {
    const sql = migrationSql(MIGRATION_0063);
    const block = companyConfigBlock();
    assert.match(sql, /CREATE TABLE mail_company_config/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_receiving_addresses/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_inbound/);
    assert.doesNotMatch(sql, /INSERT INTO mail_company_config/);
    assert.doesNotMatch(block, /ON DELETE CASCADE/);
  });

  it("singleton CHECK and FK to mail_mailboxes", () => {
    const block = companyConfigBlock();
    assert.match(block, /CHECK \(id = 'default'\)/);
    assert.match(
      block,
      /FOREIGN KEY \(inbound_fallback_mailbox_id\) REFERENCES mail_mailboxes \(id\)/,
    );
    assert.match(block, /inbound_fallback_mailbox_id TEXT NOT NULL/);
  });

  it("drizzle schema exported", () => {
    const source = readFileSync(DRIZZLE_PATH, "utf8");
    assert.match(source, /mailCompanyConfig/);
    assert.match(source, /MAIL_COMPANY_CONFIG_SINGLETON_ID = "default"/);
  });

  it("0052–0062 unchanged on disk", () => {
    for (const name of FROZEN_MIGRATIONS) {
      const path = join(process.cwd(), "drizzle/migrations", name);
      statSync(path);
      assert.ok(migrationSql(path).length > 0, `${name} must exist`);
    }
    assert.doesNotMatch(migrationSql(MIGRATION_0063), /ALTER TABLE mail_admin_grants/);
  });
});
