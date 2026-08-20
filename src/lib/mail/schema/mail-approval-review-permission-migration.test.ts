import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_0052 = join(
  process.cwd(),
  "drizzle/migrations/0052_mail_foundation.sql",
);
const MIGRATION_0061 = join(
  process.cwd(),
  "drizzle/migrations/0061_mail_provider_ingestion.sql",
);
const MIGRATION_0062 = join(
  process.cwd(),
  "drizzle/migrations/0062_mail_approval_review_permission.sql",
);

const FROZEN_PERMISSIONS = [
  "super_admin",
  "global_mail_read",
  "account_mgmt",
  "address_assignment",
  "signature_template",
  "auto_reply",
  "audit_view",
  "domain_health",
  "delivery_health",
  "permission_mgmt",
] as const;

function migrationSql(path: string): string {
  return readFileSync(path, "utf8");
}

function mailAdminGrantsCheckBlock(sql: string): string {
  return sql.match(/CREATE TABLE mail_admin_grants[^;]*CHECK \([\s\S]*?\)\s*\)/)?.[0] ?? "";
}

describe("0062 approval_review permission migration (static)", () => {
  it("0062 exists after 0061", () => {
    assert.match(migrationSql(MIGRATION_0062), /0062|approval_review/);
    assert.doesNotMatch(migrationSql(MIGRATION_0061), /approval_review/);
  });

  it("0052 remains unchanged on disk", () => {
    const sql = migrationSql(MIGRATION_0052);
    assert.doesNotMatch(sql, /'approval_review'/);
    for (const permission of FROZEN_PERMISSIONS) {
      assert.match(sql, new RegExp(`'${permission}'`));
    }
  });

  it("0062 changes only mail_admin_grants permission CHECK semantics", () => {
    const sql = migrationSql(MIGRATION_0062);
    assert.match(sql, /mail_admin_grants_new/);
    assert.match(sql, /DROP TABLE mail_admin_grants/);
    assert.match(sql, /RENAME TO mail_admin_grants/);
    assert.doesNotMatch(sql, /CREATE TABLE mail_mailboxes/);
    assert.doesNotMatch(sql, /CREATE TABLE mail_outbound_approvals/);
    assert.doesNotMatch(sql, /ALTER TABLE mail_admin_grants ADD/);
  });

  it("0062 includes approval_review and preserves existing 10 permissions", () => {
    const block = mailAdminGrantsCheckBlock(migrationSql(MIGRATION_0062));
    assert.match(block, /'approval_review'/);
    for (const permission of FROZEN_PERMISSIONS) {
      assert.match(block, new RegExp(`'${permission}'`));
    }
  });

  it("0062 recreates indexes exactly", () => {
    const sql = migrationSql(MIGRATION_0062);
    assert.match(sql, /idx_mail_admin_grants_user_id/);
    assert.match(sql, /idx_mail_admin_grants_permission/);
    assert.match(
      sql,
      /uq_mail_admin_grants_user_permission_active[\s\S]*WHERE revoked_at IS NULL/,
    );
  });

  it("0062 preserves column set and foreign keys", () => {
    const sql = migrationSql(MIGRATION_0062);
    for (const column of [
      "id",
      "user_id",
      "permission",
      "granted_by",
      "granted_at",
      "revoked_at",
      "revoked_by",
      "revoke_reason",
      "created_at",
      "updated_at",
    ]) {
      assert.match(sql, new RegExp(column));
    }
    assert.match(sql, /FOREIGN KEY \(user_id\) REFERENCES users \(id\)/);
    assert.match(
      sql,
      /FOREIGN KEY \(granted_by\) REFERENCES users \(id\) ON DELETE SET NULL/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \(revoked_by\) REFERENCES users \(id\) ON DELETE SET NULL/,
    );
  });
});
