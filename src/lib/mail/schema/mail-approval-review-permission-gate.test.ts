import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAIL_ADMIN_PERMISSIONS } from "../../../../drizzle/schema/mail-admin-grants";

const FROZEN_PERMISSIONS_0052 = [
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

const MIGRATION_0052 = join(
  process.cwd(),
  "drizzle/migrations/0052_mail_foundation.sql",
);

function mailAdminGrantsCheckBlock(): string {
  const sql = readFileSync(MIGRATION_0052, "utf8");
  return (
    sql.match(/CREATE TABLE mail_admin_grants \([\s\S]*?\);/)?.[0] ?? ""
  );
}

describe("approval_review permission schema gate (2C.6.1 / post-0062)", () => {
  it("frozen 0052 CHECK enumerates original 10 permission values", () => {
    const block = mailAdminGrantsCheckBlock();
    assert.match(block, /CHECK \(\s*permission IN \(/);
    for (const permission of FROZEN_PERMISSIONS_0052) {
      assert.match(block, new RegExp(`'${permission}'`));
    }
  });

  it("approval_review is NOT in frozen 0052 but is in Drizzle enum after 0062", () => {
    const block = mailAdminGrantsCheckBlock();
    assert.doesNotMatch(block, /'approval_review'/);
    assert.equal(
      (MAIL_ADMIN_PERMISSIONS as readonly string[]).includes("approval_review"),
      true,
    );
  });

  it("documents 0062 table-rebuild evolution path", () => {
    const block = mailAdminGrantsCheckBlock();
    assert.ok(block.length > 0);
    // SQLite CHECK on mail_admin_grants.permission must be extended to include
    // 'approval_review' via a new additive migration (table rebuild pattern).
    assert.match(block, /permission IN \(/);
  });
});
