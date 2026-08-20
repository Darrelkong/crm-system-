import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAIL_ADMIN_PERMISSIONS } from "../../../../drizzle/schema/mail-admin-grants";
import {
  MAIL_NOTIFICATION_DELIVERY_HEALTH,
  MAIL_NOTIFICATION_VERIFICATION_STATUSES,
} from "../../../../drizzle/schema/mail-notification-identities";
import {
  MAIL_MAILBOX_STATUSES,
  MAIL_MAILBOX_TYPES,
} from "../../../../drizzle/schema/mail-mailboxes";
import { MAIL_SENDER_IDENTITY_STATUSES } from "../../../../drizzle/schema/mail-sender-identities";

const MIGRATION_PATH = join(
  process.cwd(),
  "drizzle/migrations/0052_mail_foundation.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("mail foundation migration (static)", () => {
  it("defines all seven foundation tables", () => {
    const sql = migrationSql();
    for (const table of [
      "mail_user_access",
      "mail_admin_grants",
      "mail_notification_identities",
      "mail_mailboxes",
      "mail_sender_identities",
      "mail_mailbox_members",
      "mail_sender_identity_grants",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE ${table}`), table);
    }
  });

  it("A: supports old verified + new pending coexistence via separate partial uniques", () => {
    const sql = migrationSql();
    assert.match(sql, /uq_mail_notification_identities_user_verified_active/);
    assert.match(sql, /uq_mail_notification_identities_user_pending_active/);
    assert.match(
      sql,
      /verification_status = 'verified' AND revoked_at IS NULL/,
    );
    assert.match(sql, /verification_status = 'pending' AND revoked_at IS NULL/);
    assert.match(
      sql,
      /Partial uniques allow one active verified AND one active pending per user/,
    );
  });

  it("B: allows only one active verified notification identity per user", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_notification_identities_user_verified_active[\s\S]*?ON mail_notification_identities \(user_id\)[\s\S]*?WHERE verification_status = 'verified' AND revoked_at IS NULL/,
    );
  });

  it("C: allows only one active pending notification identity per user", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_notification_identities_user_pending_active[\s\S]*?ON mail_notification_identities \(user_id\)[\s\S]*?WHERE verification_status = 'pending' AND revoked_at IS NULL/,
    );
  });

  it("D: case variants cannot represent two separate active notification identities", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_notification_identities_email_active[\s\S]*?ON mail_notification_identities \(lower\(email\)\)/,
    );
    assert.match(
      sql,
      /WHERE verification_status IN \('pending', 'verified'\) AND revoked_at IS NULL/,
    );
  });

  it("E: mailbox address uniqueness is lifetime-global and case-insensitive", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_mailboxes_address\s+ON mail_mailboxes \(lower\(address\)\);/,
    );
  });

  it("F: sender identity address uniqueness is lifetime-global and case-insensitive", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /CREATE UNIQUE INDEX uq_mail_sender_identities_address\s+ON mail_sender_identities \(lower\(address\)\);/,
    );
  });

  it("G: soft deletion does not free mailbox or sender identity address for reuse", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /uq_mail_mailboxes_address_active/);
    assert.doesNotMatch(sql, /uq_mail_sender_identities_address_active/);
    assert.match(
      sql,
      /Soft delete does NOT release the address/i,
      "mailbox comment",
    );
    assert.match(
      sql,
      /Deleted identities do NOT release the address/i,
      "sender identity comment",
    );
    assert.doesNotMatch(
      sql,
      /uq_mail_mailboxes_address[\s\S]*?status != 'deleted'/i,
    );
    assert.doesNotMatch(
      sql,
      /uq_mail_sender_identities_address[\s\S]*?status IN/i,
    );
  });

  it("documents notification atomic swap order: revoke verified before promote pending", () => {
    const sql = migrationSql();
    assert.match(sql, /REVOKE the currently verified identity/i);
    assert.match(sql, /PROMOTE the new pending identity to verified/i);
    assert.match(
      sql,
      /Promoting new before revoking old would violate uq_\.\.\._user_verified_active/i,
    );
    assert.doesNotMatch(
      sql,
      /Atomic switch on verify: verify new, then revoke old/i,
      "incorrect swap order must not remain documented",
    );
  });

  it("enforces sender identity mailbox routing CHECK", () => {
    const sql = migrationSql();
    assert.match(
      sql,
      /default_mailbox_id IS NOT NULL\s+OR sent_folder_mailbox_id IS NOT NULL/,
    );
  });

  it("drizzle enums are represented in migration CHECK constraints", () => {
    const sql = migrationSql();
    const permissionsIn0052 = MAIL_ADMIN_PERMISSIONS.filter(
      (permission) => permission !== "approval_review",
    );
    for (const permission of permissionsIn0052) {
      assert.match(sql, new RegExp(`'${permission}'`));
    }
    for (const status of MAIL_NOTIFICATION_VERIFICATION_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
    for (const health of MAIL_NOTIFICATION_DELIVERY_HEALTH) {
      assert.match(sql, new RegExp(`'${health}'`));
    }
    for (const type of MAIL_MAILBOX_TYPES) {
      assert.match(sql, new RegExp(`'${type}'`));
    }
    for (const status of MAIL_MAILBOX_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
    for (const status of MAIL_SENDER_IDENTITY_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
  });

  it("does not insert seed data", () => {
    const sql = migrationSql();
    assert.doesNotMatch(sql, /INSERT INTO/i);
  });

  it("H: uses filesystem migration source only (no database bindings)", () => {
    const source = readFileSync(import.meta.filename, "utf8");
    const importLines = source.match(/^import .+$/gm) ?? [];
    assert.ok(importLines.length > 0);
    for (const line of importLines) {
      assert.doesNotMatch(line, /\/lib\/db/);
      assert.doesNotMatch(line, /miniflare/);
    }
    assert.match(migrationSql(), /^-- Phase 2B\.1:/m);
  });
});
