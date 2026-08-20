#!/usr/bin/env node
/**
 * Phase 2B.2 — Local D1 foundation constraint verification.
 * LOCAL ONLY: uses `wrangler d1 execute crm-db --local`.
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const NOW = "2026-08-19T05:30:00.000Z";
const PREFIX = "mail-phase2b2";
const USER_ID = `${PREFIX}-user-001`;
const USER_EMAIL = `${PREFIX}-user@example.test`;
const MAILBOX_ID = `${PREFIX}-mailbox-001`;
const MAILBOX_ID_2 = `${PREFIX}-mailbox-002`;
const SENDER_ID = `${PREFIX}-sender-001`;
const SENDER_ID_2 = `${PREFIX}-sender-002`;
const NOTIF_OLD_ID = `${PREFIX}-notif-old`;
const NOTIF_NEW_ID = `${PREFIX}-notif-new`;
const MEMBER_ID = `${PREFIX}-member-001`;
const GRANT_ID = `${PREFIX}-grant-001`;

const results = [];

function d1(sql, { expectFailure = false } = {}) {
  try {
    const out = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "crm-db", "--local", "--command", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (expectFailure) {
      throw new Error(`Expected failure but succeeded:\n${sql}\n${out}`);
    }
    return out;
  } catch (error) {
    if (expectFailure) {
      return String(error.stderr ?? error.message);
    }
    throw error;
  }
}

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function run(name, fn) {
  try {
    fn();
    if (!results.some((r) => r.name === name && !r.ok)) {
      if (!results.some((r) => r.name === name)) pass(name);
    }
  } catch (error) {
    fail(name, error.message);
  }
}

function setupFixtures() {
  d1(`INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
      VALUES ('${USER_ID}', '${USER_EMAIL}', 'Mail Phase2B2 Test User', 'fixture-hash', 'staff', 1, 0, 0, 0, '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES ('${MAILBOX_ID}', 'Hello@echfronthk.test', 'Fixture Mailbox', 'shared', 'active', '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES ('${MAILBOX_ID_2}', '${PREFIX}-mailbox2@example.test', 'Fixture Mailbox 2', 'personal', 'active', '${NOW}', '${NOW}');`);
}

function cleanupFixtures() {
  const stmts = [
    `DELETE FROM mail_sender_identity_grants WHERE id LIKE '${PREFIX}%';`,
    `DELETE FROM mail_mailbox_members WHERE id LIKE '${PREFIX}%';`,
    `DELETE FROM mail_sender_identities WHERE id LIKE '${PREFIX}%';`,
    `DELETE FROM mail_notification_identities WHERE id LIKE '${PREFIX}%';`,
    `DELETE FROM mail_admin_grants WHERE id LIKE '${PREFIX}%';`,
    `DELETE FROM mail_user_access WHERE user_id LIKE '${PREFIX}%';`,
    `DELETE FROM mail_mailboxes WHERE id LIKE '${PREFIX}%';`,
    `DELETE FROM users WHERE id LIKE '${PREFIX}%';`,
  ];
  for (const sql of stmts) {
    try {
      d1(sql);
    } catch {
      // best-effort cleanup
    }
  }
}

console.log("=== Phase 2B.2 Local D1 Verification ===\n");

cleanupFixtures();
setupFixtures();

run("G10: notification verified + pending coexist", () => {
  d1(`INSERT INTO mail_notification_identities (id, user_id, email, verification_status, verified_at, created_at, updated_at)
      VALUES ('${NOTIF_OLD_ID}', '${USER_ID}', 'old@example.test', 'verified', '${NOW}', '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_notification_identities (id, user_id, email, verification_status, created_at, updated_at)
      VALUES ('${NOTIF_NEW_ID}', '${USER_ID}', 'new@example.test', 'pending', '${NOW}', '${NOW}');`);
  pass("G10: notification verified + pending coexist");
});

run("G11: second active verified rejected", () => {
  const err = d1(
    `INSERT INTO mail_notification_identities (id, user_id, email, verification_status, verified_at, created_at, updated_at)
     VALUES ('${PREFIX}-notif-verified2', '${USER_ID}', 'other-verified@example.test', 'verified', '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i, err);
  pass("G11: second active verified rejected");
});

run("G12: second active pending rejected", () => {
  const err = d1(
    `INSERT INTO mail_notification_identities (id, user_id, email, verification_status, created_at, updated_at)
     VALUES ('${PREFIX}-notif-pending2', '${USER_ID}', 'other-pending@example.test', 'pending', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i, err);
  pass("G12: second active pending rejected");
});

run("G13: notification email case-insensitive uniqueness", () => {
  const userA = `${PREFIX}-user-case-a`;
  const userB = `${PREFIX}-user-case-b`;
  d1(`INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
      VALUES ('${userA}', '${PREFIX}-case-a@example.test', 'Case A', 'fixture-hash', 'staff', 1, 0, 0, 0, '${NOW}', '${NOW}');`);
  d1(`INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
      VALUES ('${userB}', '${PREFIX}-case-b@example.test', 'Case B', 'fixture-hash', 'staff', 1, 0, 0, 0, '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_notification_identities (id, user_id, email, verification_status, created_at, updated_at)
      VALUES ('${PREFIX}-notif-case-a', '${userA}', 'Daniel@Test.Example', 'pending', '${NOW}', '${NOW}');`);
  const err = d1(
    `INSERT INTO mail_notification_identities (id, user_id, email, verification_status, created_at, updated_at)
     VALUES ('${PREFIX}-notif-case-b', '${userB}', 'daniel@test.example', 'pending', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i, err);
  pass("G13: notification email case-insensitive uniqueness");
});

run("G14: notification atomic swap simulation", () => {
  // D1 wrangler execute rejects SQL BEGIN/COMMIT; service layer uses D1 transaction API.
  // Ordered updates prove the constraint-safe swap sequence.
  d1(`UPDATE mail_notification_identities
      SET verification_status = 'revoked', revoked_at = '${NOW}', updated_at = '${NOW}'
      WHERE id = '${NOTIF_OLD_ID}';`);
  d1(`UPDATE mail_notification_identities
      SET verification_status = 'verified', verified_at = '${NOW}', updated_at = '${NOW}'
      WHERE id = '${NOTIF_NEW_ID}';`);
  const out = d1(
    `SELECT id, verification_status FROM mail_notification_identities WHERE id IN ('${NOTIF_OLD_ID}', '${NOTIF_NEW_ID}') ORDER BY id;`,
  );
  assert.match(out, /"verification_status": "revoked"/);
  assert.match(out, /"verification_status": "verified"/);
  const countOut = d1(
    `SELECT COUNT(*) AS c FROM mail_notification_identities WHERE user_id = '${USER_ID}' AND verification_status = 'verified' AND revoked_at IS NULL;`,
  );
  assert.match(countOut, /"c": 1/);
  pass("G14: notification atomic swap simulation");
});

run("G15: notification bounce independence", () => {
  d1(`UPDATE mail_notification_identities SET delivery_health = 'bounced', delivery_problem_at = '${NOW}', updated_at = '${NOW}' WHERE id = '${NOTIF_NEW_ID}';`);
  const out = d1(
    `SELECT verification_status, delivery_health FROM mail_notification_identities WHERE id = '${NOTIF_NEW_ID}';`,
  );
  assert.match(out, /"verification_status": "verified"/);
  assert.match(out, /"delivery_health": "bounced"/);
  pass("G15: notification bounce independence");
});

run("G16: mailbox case-insensitive lifetime unique", () => {
  const err = d1(
    `INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
     VALUES ('${PREFIX}-mailbox-dup', 'hello@echfronthk.test', 'Dup', 'shared', 'active', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i, err);
  d1(`UPDATE mail_mailboxes SET status = 'deleted', deleted_at = '${NOW}', updated_at = '${NOW}' WHERE id = '${MAILBOX_ID}';`);
  const err2 = d1(
    `INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, deleted_at, created_at, updated_at)
     VALUES ('${PREFIX}-mailbox-dup2', 'hello@echfronthk.test', 'Dup2', 'shared', 'deleted', '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err2, /UNIQUE|constraint|failed/i, err2);
  d1(`UPDATE mail_mailboxes SET status = 'active', deleted_at = NULL, updated_at = '${NOW}' WHERE id = '${MAILBOX_ID}';`);
  pass("G16: mailbox case-insensitive lifetime unique");
});

run("G17: sender identity case-insensitive lifetime unique", () => {
  d1(`INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
      VALUES ('${SENDER_ID}', 'From@echfronthk.test', 'Fixture Sender', 'active', '${MAILBOX_ID}', '${NOW}', '${NOW}');`);
  const err = d1(
    `INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
     VALUES ('${PREFIX}-sender-dup', 'from@echfronthk.test', 'Dup', 'active', '${MAILBOX_ID}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i, err);
  d1(`UPDATE mail_sender_identities SET status = 'deleted', updated_at = '${NOW}' WHERE id = '${SENDER_ID}';`);
  const err2 = d1(
    `INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
     VALUES ('${PREFIX}-sender-dup2', 'from@echfronthk.test', 'Dup2', 'active', '${MAILBOX_ID}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err2, /UNIQUE|constraint|failed/i, err2);
  d1(`UPDATE mail_sender_identities SET status = 'active', updated_at = '${NOW}' WHERE id = '${SENDER_ID}';`);
  pass("G17: sender identity case-insensitive lifetime unique");
});

run("G18: sender routing invariant", () => {
  const err = d1(
    `INSERT INTO mail_sender_identities (id, address, display_name, status, created_at, updated_at)
     VALUES ('${PREFIX}-sender-bad', '${PREFIX}-bad@example.test', 'Bad', 'active', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i, err);
  d1(`INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
      VALUES ('${SENDER_ID_2}', '${PREFIX}-sender2@example.test', 'Sender2', 'active', '${MAILBOX_ID_2}', '${NOW}', '${NOW}');`);
  d1(`INSERT INTO mail_sender_identities (id, address, display_name, status, sent_folder_mailbox_id, created_at, updated_at)
      VALUES ('${PREFIX}-sender3', '${PREFIX}-sender3@example.test', 'Sender3', 'active', '${MAILBOX_ID_2}', '${NOW}', '${NOW}');`);
  pass("G18: sender routing invariant");
});

run("G19: mailbox membership active unique", () => {
  d1(`INSERT INTO mail_mailbox_members (id, mailbox_id, user_id, can_read, created_at, updated_at)
      VALUES ('${MEMBER_ID}', '${MAILBOX_ID}', '${USER_ID}', 1, '${NOW}', '${NOW}');`);
  const err = d1(
    `INSERT INTO mail_mailbox_members (id, mailbox_id, user_id, can_read, created_at, updated_at)
     VALUES ('${PREFIX}-member-dup', '${MAILBOX_ID}', '${USER_ID}', 1, '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i, err);
  d1(`UPDATE mail_mailbox_members SET revoked_at = '${NOW}', updated_at = '${NOW}' WHERE id = '${MEMBER_ID}';`);
  d1(`INSERT INTO mail_mailbox_members (id, mailbox_id, user_id, can_read, created_at, updated_at)
      VALUES ('${PREFIX}-member-revived', '${MAILBOX_ID}', '${USER_ID}', 1, '${NOW}', '${NOW}');`);
  pass("G19: mailbox membership active unique");
});

run("G20: sender identity grant active unique", () => {
  d1(`INSERT INTO mail_sender_identity_grants (id, sender_identity_id, user_id, can_send, created_at, updated_at)
      VALUES ('${GRANT_ID}', '${SENDER_ID}', '${USER_ID}', 1, '${NOW}', '${NOW}');`);
  const err = d1(
    `INSERT INTO mail_sender_identity_grants (id, sender_identity_id, user_id, can_send, created_at, updated_at)
     VALUES ('${PREFIX}-grant-dup', '${SENDER_ID}', '${USER_ID}', 1, '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i, err);
  d1(`UPDATE mail_sender_identity_grants SET revoked_at = '${NOW}', updated_at = '${NOW}' WHERE id = '${GRANT_ID}';`);
  d1(`INSERT INTO mail_sender_identity_grants (id, sender_identity_id, user_id, can_send, created_at, updated_at)
      VALUES ('${PREFIX}-grant-revived', '${SENDER_ID}', '${USER_ID}', 1, '${NOW}', '${NOW}');`);
  pass("G20: sender identity grant active unique");
});

run("G21: FK delete safety (SET NULL attribution)", () => {
  const attrUser = `${PREFIX}-attr-user`;
  d1(`INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
      VALUES ('${attrUser}', '${PREFIX}-attr@example.test', 'Attr User', 'fixture-hash', 'staff', 1, 0, 0, 0, '${NOW}', '${NOW}');`);
  const grantId = `${PREFIX}-grant-attr`;
  d1(`INSERT INTO mail_admin_grants (id, user_id, permission, granted_by, granted_at, created_at, updated_at)
      VALUES ('${grantId}', '${USER_ID}', 'audit_view', '${attrUser}', '${NOW}', '${NOW}', '${NOW}');`);
  d1(`DELETE FROM users WHERE id = '${attrUser}';`);
  const out = d1(`SELECT granted_by FROM mail_admin_grants WHERE id = '${grantId}';`);
  assert.match(out, /"granted_by": null/);
  d1(`DELETE FROM mail_admin_grants WHERE id = '${grantId}';`);
  pass("G21: FK delete safety (SET NULL attribution)");
});

run("F: CHECK constraints — booleans and enums", () => {
  const badBool = d1(
    `INSERT INTO mail_user_access (user_id, is_enabled, created_at, updated_at)
     VALUES ('${PREFIX}-access-bad', 2, '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(badBool, /CHECK|constraint|failed/i, badBool);
  const badPerm = d1(
    `INSERT INTO mail_admin_grants (id, user_id, permission, granted_at, created_at, updated_at)
     VALUES ('${PREFIX}-grant-badperm', '${USER_ID}', 'not_a_permission', '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(badPerm, /CHECK|constraint|failed/i, badPerm);
  const badVerif = d1(
    `INSERT INTO mail_notification_identities (id, user_id, email, verification_status, created_at, updated_at)
     VALUES ('${PREFIX}-notif-badver', '${USER_ID}', '${PREFIX}-badver@example.test', 'verified', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(badVerif, /CHECK|constraint|failed/i, badVerif);
  const badRevoked = d1(
    `INSERT INTO mail_notification_identities (id, user_id, email, verification_status, created_at, updated_at)
     VALUES ('${PREFIX}-notif-badrev', '${USER_ID}', '${PREFIX}-badrev@example.test', 'revoked', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(badRevoked, /CHECK|constraint|failed/i, badRevoked);
  const badMailboxType = d1(
    `INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
     VALUES ('${PREFIX}-mb-badtype', '${PREFIX}-badtype@example.test', 'x', 'invalid', 'active', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(badMailboxType, /CHECK|constraint|failed/i, badMailboxType);
  const badDeleted = d1(
    `INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
     VALUES ('${PREFIX}-mb-baddeleted', '${PREFIX}-baddeleted@example.test', 'x', 'shared', 'deleted', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(badDeleted, /CHECK|constraint|failed/i, badDeleted);
  pass("F: CHECK constraints — booleans and enums");
});

console.log("\n=== Cleanup ===\n");
cleanupFixtures();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length > 0) {
  console.error("Failed tests:", failed);
  process.exit(1);
}
