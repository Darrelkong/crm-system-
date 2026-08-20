#!/usr/bin/env node
/**
 * Phase 2B.6 — Local D1 outbound content runtime verification.
 * LOCAL ONLY: wrangler d1 execute crm-db --local
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOW = "2026-08-19T15:15:00.000Z";
const P = "mail-phase2b6";
const USER = `${P}-author`;
const USER_ATTR = `${P}-attr-user`;
const CUSTOMER = `${P}-customer`;
const MAILBOX = `${P}-mailbox`;
const MAILBOX_B = `${P}-mailbox-b`;
const SENDER_A = `${P}-sender-a`;
const SENDER_B = `${P}-sender-b`;
const CHAIN = `${P}-chain`;

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

function q(v) {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
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

function insertUser(id, email = `${id}@example.test`) {
  d1(`INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
      VALUES (${q(id)}, ${q(email)}, 'Fixture', 'hash', 'staff', 1, 0, 0, 0, ${q(NOW)}, ${q(NOW)});`);
}

function insertCustomer(id, createdBy = USER) {
  d1(`INSERT INTO customers (id, customer_name, source, created_by, created_at, updated_at)
      VALUES (${q(id)}, 'Fixture Customer', 'other', ${q(createdBy)}, ${q(NOW)}, ${q(NOW)});`);
}

function insertMailbox(id, address = `${id}@mbox.example.test`) {
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES (${q(id)}, ${q(address)}, 'Mbox', 'shared', 'active', ${q(NOW)}, ${q(NOW)});`);
}

function insertSender(id, mailboxId, address = `${id}@from.example.test`) {
  d1(`INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
      VALUES (${q(id)}, ${q(address)}, 'From', 'active', ${q(mailboxId)}, ${q(NOW)}, ${q(NOW)});`);
}

function insertSigVersion(id, senderId, versionNumber, { isActive = 0, retiredAt = null } = {}) {
  d1(`INSERT INTO mail_signature_versions (id, sender_identity_id, version_number, body_text, is_active, retired_at, created_at)
      VALUES (${q(id)}, ${q(senderId)}, ${versionNumber}, 'sig', ${isActive}, ${retiredAt ? q(retiredAt) : "NULL"}, ${q(NOW)});`);
}

function insertSnapshot(id, senderId, { sourceVersionId = null, snapshotHash = "snap-hash" } = {}) {
  d1(`INSERT INTO mail_signature_snapshots (id, sender_identity_id, source_signature_version_id, body_text, snapshot_hash, created_at)
      VALUES (${q(id)}, ${q(senderId)}, ${sourceVersionId ? q(sourceVersionId) : "NULL"}, 'snap body', ${q(snapshotHash)}, ${q(NOW)});`);
}

function insertDraft(id, {
  authorUserId = USER,
  mailboxId = null,
  senderIdentityId = null,
  subject = "",
  bodyText = "meaningful draft body",
  composeMode = "new",
  autosaveVersion = 0,
  customerId = null,
  customerAssociationType = null,
  customerAssociatedByUserId = null,
  customerAssociatedAt = null,
  discardedAt = null,
} = {}) {
  d1(`INSERT INTO mail_drafts (id, author_user_id, mailbox_id, sender_identity_id, subject, body_text, sensitivity, compose_mode, autosave_version, last_saved_at, discarded_at, customer_id, customer_association_type, customer_associated_by_user_id, customer_associated_at, created_at, updated_at)
      VALUES (${q(id)}, ${q(authorUserId)}, ${mailboxId ? q(mailboxId) : "NULL"}, ${senderIdentityId ? q(senderIdentityId) : "NULL"}, ${q(subject)}, ${q(bodyText)}, 'normal', ${q(composeMode)}, ${autosaveVersion}, ${q(NOW)}, ${discardedAt ? q(discardedAt) : "NULL"}, ${customerId ? q(customerId) : "NULL"}, ${customerAssociationType ? q(customerAssociationType) : "NULL"}, ${customerAssociatedByUserId ? q(customerAssociatedByUserId) : "NULL"}, ${customerAssociatedAt ? q(customerAssociatedAt) : "NULL"}, ${q(NOW)}, ${q(NOW)});`);
}

function insertRevision(id, {
  chainId = CHAIN,
  revisionNumber = 1,
  parentRevisionId = null,
  sourceDraftId = null,
  senderIdentityId = SENDER_A,
  mailboxId = MAILBOX,
  signatureSnapshotId,
  fromAddress = `${SENDER_A}@from.example.test`,
  subject = "Valid Subject",
  composeMode = "new",
  contentHash = "content-hash-fixture",
  hashVersion = 1,
  customerId = null,
  customerAssociationType = null,
  customerAssociatedByUserId = null,
  customerAssociatedAt = null,
} = {}) {
  d1(`INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, parent_revision_id, source_draft_id, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, customer_id, customer_association_type, customer_associated_by_user_id, customer_associated_at, content_hash, hash_version)
      VALUES (${q(id)}, ${q(chainId)}, ${revisionNumber}, ${parentRevisionId ? q(parentRevisionId) : "NULL"}, ${sourceDraftId ? q(sourceDraftId) : "NULL"}, 'staff_submit', ${q(USER)}, ${q(NOW)}, ${q(mailboxId)}, ${q(senderIdentityId)}, ${q(fromAddress)}, ${q(subject)}, 'body', 'normal', ${q(composeMode)}, ${q(signatureSnapshotId)}, ${customerId ? q(customerId) : "NULL"}, ${customerAssociationType ? q(customerAssociationType) : "NULL"}, ${customerAssociatedByUserId ? q(customerAssociatedByUserId) : "NULL"}, ${customerAssociatedAt ? q(customerAssociatedAt) : "NULL"}, ${q(contentHash)}, ${hashVersion});`);
}

function cleanup() {
  const stmts = [
    `DELETE FROM mail_outbound_revision_recipients WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_revisions WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_snapshots WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_versions WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_draft_recipients WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_drafts WHERE id LIKE '${P}%';`,
    `DELETE FROM customers WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_sender_identities WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_mailboxes WHERE id LIKE '${P}%';`,
    `DELETE FROM users WHERE id LIKE '${P}%';`,
  ];
  for (const sql of stmts) {
    try {
      d1(sql);
    } catch {
      // best effort
    }
  }
}

function setupCore() {
  insertUser(USER);
  insertMailbox(MAILBOX);
  insertMailbox(MAILBOX_B);
  insertSender(SENDER_A, MAILBOX);
  insertSender(SENDER_B, MAILBOX_B);
}

console.log("=== Phase 2B.6 Local D1 Outbound Content Verification ===\n");

// --- Tables / indexes ---
run("D: six outbound content tables exist", () => {
  const out = d1(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mail_drafts','mail_draft_recipients','mail_signature_versions','mail_signature_snapshots','mail_outbound_revisions','mail_outbound_revision_recipients') ORDER BY name;`,
  );
  for (const t of [
    "mail_draft_recipients",
    "mail_drafts",
    "mail_outbound_revision_recipients",
    "mail_outbound_revisions",
    "mail_signature_snapshots",
    "mail_signature_versions",
  ]) {
    assert.match(out, new RegExp(t));
  }
});

run("D: authored indexes present", () => {
  const out = d1(
    `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%mail_draft%' OR name LIKE '%mail_signature%' OR name LIKE '%mail_outbound%' ORDER BY name;`,
  );
  const expected = [
    "idx_mail_drafts_author_discarded_updated",
    "idx_mail_drafts_mailbox_id",
    "idx_mail_draft_recipients_draft_id",
    "uq_mail_draft_recipients_draft_address",
    "idx_mail_signature_versions_sender_identity",
    "uq_mail_signature_versions_active_per_identity",
    "idx_mail_signature_snapshots_sender_identity",
    "idx_mail_signature_snapshots_source_version",
    "uq_mail_outbound_revisions_chain_number",
    "uq_mail_outbound_revisions_signature_snapshot",
    "idx_mail_outbound_revisions_source_draft",
    "idx_mail_outbound_revisions_created_by",
    "idx_mail_outbound_revisions_customer_id",
    "idx_mail_outbound_revision_recipients_revision_id",
    "uq_mail_outbound_revision_recipients_revision_address",
  ];
  for (const idx of expected) {
    assert.match(out, new RegExp(idx), `missing index ${idx}`);
  }
});

run("R: SQL-Drizzle parity spot-check composite FKs", () => {
  const sql = readFileSync(
    join(process.cwd(), "drizzle/migrations/0054_mail_outbound_content.sql"),
    "utf8",
  );
  const revSql = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_outbound_revisions';`,
  );
  assert.match(sql, /FOREIGN KEY \(signature_snapshot_id, sender_identity_id\)/);
  assert.match(revSql, /signature_snapshot_id/);
  assert.match(revSql, /body_html_sanitized/);
  assert.doesNotMatch(revSql, /updated_at/i);
});

setupCore();

// --- 7 Draft incomplete ---
run("E: draft incomplete with meaningful body passes", () => {
  insertDraft(`${P}-draft-incomplete`);
  pass("E: draft incomplete with meaningful body passes");
});

// --- 8 compose mode ---
run("E: draft compose_mode enum valid/invalid", () => {
  for (const mode of ["new", "reply", "reply_all", "forward"]) {
    insertDraft(`${P}-draft-cm-${mode}`, { composeMode: mode });
  }
  const err = d1(
    `INSERT INTO mail_drafts (id, author_user_id, subject, body_text, sensitivity, compose_mode, autosave_version, last_saved_at, created_at, updated_at) VALUES ('${P}-draft-cm-bad', '${USER}', '', 'body', 'normal', 'invalid', 0, '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i);
});

// --- 9 autosave ---
run("E: draft autosave_version bounds", () => {
  insertDraft(`${P}-draft-as-0`, { autosaveVersion: 0 });
  insertDraft(`${P}-draft-as-1`, { autosaveVersion: 3 });
  const err = d1(
    `INSERT INTO mail_drafts (id, author_user_id, subject, body_text, sensitivity, compose_mode, autosave_version, last_saved_at, created_at, updated_at) VALUES ('${P}-draft-as-neg', '${USER}', '', 'body', 'normal', 'new', -1, '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i);
});

// --- 10 draft recipients ---
run("F: draft recipient cross-type uniqueness", () => {
  const draft = `${P}-draft-rcpt`;
  insertDraft(draft);
  d1(`INSERT INTO mail_draft_recipients (id, draft_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-dr1', '${draft}', 'to', 'john@example.test', 0, '${NOW}');`);
  const errCc = d1(
    `INSERT INTO mail_draft_recipients (id, draft_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-dr2', '${draft}', 'cc', 'JOHN@example.test', 1, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errCc, /UNIQUE|constraint|failed/i);
  const errBcc = d1(
    `INSERT INTO mail_draft_recipients (id, draft_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-dr3', '${draft}', 'bcc', 'john@example.test', 2, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errBcc, /UNIQUE|constraint|failed/i);
  const draft2 = `${P}-draft-rcpt-b`;
  insertDraft(draft2);
  d1(`INSERT INTO mail_draft_recipients (id, draft_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-dr4', '${draft2}', 'to', 'john@example.test', 0, '${NOW}');`);
  const errType = d1(
    `INSERT INTO mail_draft_recipients (id, draft_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-dr5', '${draft}', 'invalid', 'other@example.test', 0, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errType, /CHECK|constraint|failed/i);
});

// --- 11 customer no customer ---
run("G: draft customer_id NULL requires metadata NULL", () => {
  const err1 = d1(
    `INSERT INTO mail_drafts (id, author_user_id, subject, body_text, sensitivity, compose_mode, autosave_version, last_saved_at, customer_association_type, created_at, updated_at) VALUES ('${P}-draft-cust-bad1', '${USER}', '', 'body', 'normal', 'new', 0, '${NOW}', 'manual', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err1, /CHECK|constraint|failed/i);
  insertDraft(`${P}-draft-cust-ok`, {
    customerId: null,
    customerAssociationType: null,
    customerAssociatedAt: null,
  });
});

// --- 12 customer set ---
run("G: draft customer association required fields", () => {
  insertCustomer(CUSTOMER);
  insertDraft(`${P}-draft-cust-full`, {
    customerId: CUSTOMER,
    customerAssociationType: "manual",
    customerAssociatedByUserId: USER,
    customerAssociatedAt: NOW,
  });
  insertDraft(`${P}-draft-cust-no-actor`, {
    customerId: CUSTOMER,
    customerAssociationType: "auto_match",
    customerAssociatedByUserId: null,
    customerAssociatedAt: NOW,
  });
  const errType = d1(
    `INSERT INTO mail_drafts (id, author_user_id, subject, body_text, sensitivity, compose_mode, autosave_version, last_saved_at, customer_id, customer_associated_at, created_at, updated_at) VALUES ('${P}-draft-cust-notype', '${USER}', '', 'body', 'normal', 'new', 0, '${NOW}', '${CUSTOMER}', '${NOW}', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errType, /CHECK|constraint|failed/i);
  const errAt = d1(
    `INSERT INTO mail_drafts (id, author_user_id, subject, body_text, sensitivity, compose_mode, autosave_version, last_saved_at, customer_id, customer_association_type, created_at, updated_at) VALUES ('${P}-draft-cust-noat', '${USER}', '', 'body', 'normal', 'new', 0, '${NOW}', '${CUSTOMER}', 'manual', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errAt, /CHECK|constraint|failed/i);
});

// --- 13 attribution delete ---
run("H: customer attribution ON DELETE SET NULL preserves association", () => {
  insertUser(USER_ATTR);
  const cust = `${P}-customer-attr`;
  const draft = `${P}-draft-attr`;
  insertCustomer(cust, USER);
  insertDraft(draft, {
    customerId: cust,
    customerAssociationType: "manual",
    customerAssociatedByUserId: USER_ATTR,
    customerAssociatedAt: NOW,
  });
  d1(`DELETE FROM users WHERE id = '${USER_ATTR}';`);
  const row = d1(
    `SELECT customer_id, customer_association_type, customer_associated_by_user_id, customer_associated_at FROM mail_drafts WHERE id = '${draft}';`,
  );
  assert.match(row, new RegExp(cust));
  assert.match(row, /manual/i);
  assert.match(row, /null/i);
});

// --- 14 signature version basic ---
run("I: signature version basic + duplicate version_number", () => {
  insertSigVersion(`${P}-sigv1`, SENDER_A, 1, { isActive: 1 });
  const err = d1(
    `INSERT INTO mail_signature_versions (id, sender_identity_id, version_number, body_text, is_active, created_at) VALUES ('${P}-sigv-dup', '${SENDER_A}', 1, 'x', 0, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i);
});

// --- 15 one active ---
run("I: one active signature version per identity", () => {
  const sender = `${P}-sender-active`;
  const mb = `${P}-mb-active`;
  insertMailbox(mb);
  insertSender(sender, mb);
  insertSigVersion(`${P}-sigv-a1`, sender, 1, { isActive: 1 });
  const err = d1(
    `INSERT INTO mail_signature_versions (id, sender_identity_id, version_number, body_text, is_active, created_at) VALUES ('${P}-sigv-a2', '${sender}', 2, 'x', 1, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i);
  d1(`UPDATE mail_signature_versions SET is_active = 0 WHERE id = '${P}-sigv-a1';`);
  insertSigVersion(`${P}-sigv-a2`, sender, 2, { isActive: 1 });
});

// --- 16 active/retired ---
run("I: signature active/retired CHECK runtime", () => {
  const sender = `${P}-sender-life`;
  const mb = `${P}-mb-life`;
  insertMailbox(mb);
  insertSender(sender, mb);
  insertSigVersion(`${P}-sigv-life-a`, sender, 1, { isActive: 1, retiredAt: null });
  insertSigVersion(`${P}-sigv-life-b`, sender, 2, { isActive: 0, retiredAt: null });
  insertSigVersion(`${P}-sigv-life-c`, sender, 3, {
    isActive: 0,
    retiredAt: NOW,
  });
  const err = d1(
    `INSERT INTO mail_signature_versions (id, sender_identity_id, version_number, body_text, is_active, retired_at, created_at) VALUES ('${P}-sigv-life-d', '${sender}', 4, 'x', 1, '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i);
});

// --- 17 snapshot without source version ---
run("J: snapshot without source_signature_version_id", () => {
  insertSnapshot(`${P}-snap-nosrc`, SENDER_A, { sourceVersionId: null });
});

// --- 18 snapshot same identity version ---
run("J: snapshot source version same identity", () => {
  insertSigVersion(`${P}-sigv-match`, SENDER_A, 10);
  insertSnapshot(`${P}-snap-match`, SENDER_A, {
    sourceVersionId: `${P}-sigv-match`,
  });
});

// --- 19 cross-identity snapshot version ---
run("J: snapshot source version cross-identity REJECTED", () => {
  insertSigVersion(`${P}-sigv-b-only`, SENDER_B, 1);
  const err = d1(
    `INSERT INTO mail_signature_snapshots (id, sender_identity_id, source_signature_version_id, body_text, snapshot_hash, created_at) VALUES ('${P}-snap-cross', '${SENDER_A}', '${P}-sigv-b-only', 'x', 'h', '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(err, /FOREIGN KEY|constraint|failed/i);
});

// --- 20 revision same identity snapshot ---
run("K: revision snapshot same identity", () => {
  insertSnapshot(`${P}-snap-rev-ok`, SENDER_A);
  insertRevision(`${P}-rev-ok`, {
    signatureSnapshotId: `${P}-snap-rev-ok`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
});

// --- 21 cross-identity revision snapshot ---
run("K: revision snapshot cross-identity REJECTED", () => {
  insertSnapshot(`${P}-snap-rev-b`, SENDER_B);
  const err = d1(
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-cross', '${P}-chain-cross', 1, 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-rev-b', 'h', 1);`,
    { expectFailure: true },
  );
  assert.match(err, /FOREIGN KEY|constraint|failed/i);
});

// --- 22 snapshot ownership ---
run("L: signature snapshot entity ownership unique", () => {
  insertSnapshot(`${P}-snap-own`, SENDER_A, { snapshotHash: "same-hash" });
  insertRevision(`${P}-rev-own-a`, {
    chainId: `${P}-chain-own-a`,
    signatureSnapshotId: `${P}-snap-own`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
  const err = d1(
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-own-b', '${P}-chain-own-b', 1, 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-own', 'h2', 1);`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i);
  insertSnapshot(`${P}-snap-own-b`, SENDER_A, { snapshotHash: "same-hash" });
  insertRevision(`${P}-rev-own-b`, {
    chainId: `${P}-chain-own-b`,
    signatureSnapshotId: `${P}-snap-own-b`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
});

// --- 23 revision number lower bound ---
run("M: revision_number lower bound", () => {
  insertSnapshot(`${P}-snap-rn`, SENDER_A);
  for (const n of [0, -1]) {
    const err = d1(
      `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-rn-${n}', '${P}-chain-rn-${n}', ${n}, 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-rn', 'h', 1);`,
      { expectFailure: true },
    );
    assert.match(err, /CHECK|constraint|failed/i);
  }
});

// --- 24 parent structure ---
run("M: revision parent structure", () => {
  insertSnapshot(`${P}-snap-p1`, SENDER_A);
  insertRevision(`${P}-rev-p1`, {
    chainId: `${P}-chain-p`,
    revisionNumber: 1,
    parentRevisionId: null,
    signatureSnapshotId: `${P}-snap-p1`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
  insertSnapshot(`${P}-snap-p1b`, SENDER_A);
  const errParentOn1 = d1(
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, parent_revision_id, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-p1b', '${P}-chain-p2', 1, '${P}-rev-p1', 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-p1b', 'h', 1);`,
    { expectFailure: true },
  );
  assert.match(errParentOn1, /CHECK|constraint|failed/i);
  insertSnapshot(`${P}-snap-p2`, SENDER_A);
  const errNoParent = d1(
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, parent_revision_id, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-p2bad', '${P}-chain-p3', 2, NULL, 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-p2', 'h', 1);`,
    { expectFailure: true },
  );
  assert.match(errNoParent, /CHECK|constraint|failed/i);
  insertSnapshot(`${P}-snap-p2ok`, SENDER_A);
  insertRevision(`${P}-rev-p2`, {
    chainId: `${P}-chain-p`,
    revisionNumber: 2,
    parentRevisionId: `${P}-rev-p1`,
    signatureSnapshotId: `${P}-snap-p2ok`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
});

// --- 25 self parent ---
run("M: self-parent revision REJECTED", () => {
  insertSnapshot(`${P}-snap-self`, SENDER_A);
  const err = d1(
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, parent_revision_id, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-self', '${P}-chain-self', 1, '${P}-rev-self', 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-self', 'h', 1);`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i);
});

// --- 26 chain unique ---
run("M: revision chain number unique per chain", () => {
  insertSnapshot(`${P}-snap-cu1`, SENDER_A);
  insertRevision(`${P}-rev-cu1`, {
    chainId: `${P}-chain-cu`,
    revisionNumber: 1,
    signatureSnapshotId: `${P}-snap-cu1`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
  insertSnapshot(`${P}-snap-cu2`, SENDER_A);
  const err = d1(
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-cu-dup', '${P}-chain-cu', 1, 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-cu2', 'h', 1);`,
    { expectFailure: true },
  );
  assert.match(err, /UNIQUE|constraint|failed/i);
  insertSnapshot(`${P}-snap-cu3`, SENDER_A);
  insertRevision(`${P}-rev-cu-other`, {
    chainId: `${P}-chain-cu-other`,
    revisionNumber: 1,
    signatureSnapshotId: `${P}-snap-cu3`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
});

// --- 27 subject ---
run("N: revision subject trim CHECK", () => {
  insertSnapshot(`${P}-snap-subj`, SENDER_A);
  insertRevision(`${P}-rev-subj-ok`, {
    chainId: `${P}-chain-subj-ok`,
    signatureSnapshotId: `${P}-snap-subj`,
    subject: "Valid Subject",
    fromAddress: `${P}-sender-a@from.example.test`,
  });
  for (const subj of ["", "   "]) {
    insertSnapshot(`${P}-snap-subj-${subj.length}`, SENDER_A);
    const err = d1(
      `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-subj-bad-${subj.length}', '${P}-chain-subj-bad-${subj.length}', 1, 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', ${q(subj)}, 'b', 'normal', 'new', '${P}-snap-subj-${subj.length}', 'h', 1);`,
      { expectFailure: true },
    );
    assert.match(err, /CHECK|constraint|failed/i);
  }
});

// --- 28 required context ---
run("N: revision required sender context NOT NULL", () => {
  insertSnapshot(`${P}-snap-req`, SENDER_A);
  const base = `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-req-bad', '${P}-chain-req', 1, 'staff_submit', '${USER}', '${NOW}', NULL, '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-req', 'h', 1);`;
  const err = d1(base, { expectFailure: true });
  assert.match(err, /NOT NULL|constraint|failed/i);
});

// --- 29 HTML boundary ---
run("N: revision uses body_html_sanitized not draft body_html", () => {
  const revSql = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_outbound_revisions';`,
  );
  const draftSql = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_drafts';`,
  );
  assert.match(revSql, /body_html_sanitized/);
  assert.doesNotMatch(revSql, /body_html TEXT/);
  assert.match(draftSql, /body_html TEXT/);
});

// --- 30 revision recipients ---
run("O: revision recipient cross-type uniqueness", () => {
  insertSnapshot(`${P}-snap-rr`, SENDER_A);
  const rev = `${P}-rev-rr`;
  insertRevision(rev, {
    chainId: `${P}-chain-rr`,
    signatureSnapshotId: `${P}-snap-rr`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
  d1(`INSERT INTO mail_outbound_revision_recipients (id, revision_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-rr1', '${rev}', 'to', 'john@example.test', 0, '${NOW}');`);
  const errCc = d1(
    `INSERT INTO mail_outbound_revision_recipients (id, revision_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-rr2', '${rev}', 'cc', 'JOHN@example.test', 1, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errCc, /UNIQUE|constraint|failed/i);
  const errBcc = d1(
    `INSERT INTO mail_outbound_revision_recipients (id, revision_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-rr3', '${rev}', 'bcc', 'john@example.test', 2, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errBcc, /UNIQUE|constraint|failed/i);
  d1(`INSERT INTO mail_outbound_revision_recipients (id, revision_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-rr4', '${rev}', 'cc', 'other@example.test', 3, '${NOW}');`);
  insertSnapshot(`${P}-snap-rr-b`, SENDER_A);
  const rev2 = `${P}-rev-rr-b`;
  insertRevision(rev2, {
    chainId: `${P}-chain-rr-b`,
    signatureSnapshotId: `${P}-snap-rr-b`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
  d1(`INSERT INTO mail_outbound_revision_recipients (id, revision_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-rr5', '${rev2}', 'to', 'john@example.test', 0, '${NOW}');`);
  const errType = d1(
    `INSERT INTO mail_outbound_revision_recipients (id, revision_id, recipient_type, address, sort_order, created_at) VALUES ('${P}-rr6', '${rev}', 'invalid', 'x@example.test', 0, '${NOW}');`,
    { expectFailure: true },
  );
  assert.match(errType, /CHECK|constraint|failed/i);
});

// --- 31 recipient minimum service layer ---
run("O: no DB recipient minimum trigger — revision without recipients allowed", () => {
  insertSnapshot(`${P}-snap-norcp`, SENDER_A);
  insertRevision(`${P}-rev-norcp`, {
    chainId: `${P}-chain-norcp`,
    signatureSnapshotId: `${P}-snap-norcp`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
  pass("O: no DB recipient minimum — service layer enforces >=1 across To+Cc+Bcc");
});

// --- 32 hash fields ---
run("P: content_hash and hash_version CHECK", () => {
  insertSnapshot(`${P}-snap-hash`, SENDER_A);
  const err = d1(
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version) VALUES ('${P}-rev-hash-bad', '${P}-chain-hash', 1, 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-hash', 'h', 0);`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i);
});

// --- 33 CRM not hash coupled ---
run("P: no customer_id to content_hash DB coupling", () => {
  const sql = readFileSync(
    join(process.cwd(), "drizzle/migrations/0054_mail_outbound_content.sql"),
    "utf8",
  );
  assert.match(sql, /CRM customer association is NOT part of content_hash/i);
  assert.doesNotMatch(sql, /TRIGGER/i);
});

// --- 34 immutability structure ---
run("P: revision immutability structure — no updated_at/approval/send state", () => {
  const revSql = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_outbound_revisions';`,
  );
  assert.doesNotMatch(revSql, /updated_at/i);
  assert.doesNotMatch(revSql, /approval_state/i);
  assert.doesNotMatch(revSql, /send_state/i);
  assert.doesNotMatch(revSql, /delivery_state/i);
});

// --- 35 from address historical ---
run("Q: from_address no live FK to sender identity address", () => {
  const revSql = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_outbound_revisions';`,
  );
  assert.doesNotMatch(revSql, /FOREIGN KEY \(from_address\)/i);
  insertSnapshot(`${P}-snap-from`, SENDER_A);
  insertRevision(`${P}-rev-from-mismatch`, {
    chainId: `${P}-chain-from`,
    signatureSnapshotId: `${P}-snap-from`,
    fromAddress: "historical-different@example.test",
  });
  pass("Q: from_address mismatch allowed at DB — service must verify");
});

// --- 36 FK retention ---
run("Q: FK retention — cannot delete provenance rows", () => {
  insertSigVersion(`${P}-sigv-fk`, SENDER_A, 99);
  const errSender = d1(`DELETE FROM mail_sender_identities WHERE id = '${SENDER_A}';`, {
    expectFailure: true,
  });
  assert.match(errSender, /FOREIGN KEY|constraint|failed/i);
  insertSnapshot(`${P}-snap-fk`, SENDER_A);
  insertRevision(`${P}-rev-fk`, {
    chainId: `${P}-chain-fk`,
    signatureSnapshotId: `${P}-snap-fk`,
    fromAddress: `${P}-sender-a@from.example.test`,
  });
  const errSnap = d1(`DELETE FROM mail_signature_snapshots WHERE id = '${P}-snap-fk';`, {
    expectFailure: true,
  });
  assert.match(errSnap, /FOREIGN KEY|constraint|failed/i);
  const draftFk = `${P}-draft-fk`;
  insertDraft(draftFk);
  d1(`UPDATE mail_outbound_revisions SET source_draft_id = '${draftFk}' WHERE id = '${P}-rev-fk';`);
  const errDraft = d1(`DELETE FROM mail_drafts WHERE id = '${draftFk}';`, {
    expectFailure: true,
  });
  assert.match(errDraft, /FOREIGN KEY|constraint|failed/i);
  insertDraft(`${P}-draft-cust-fk`, {
    customerId: CUSTOMER,
    customerAssociationType: "manual",
    customerAssociatedAt: NOW,
  });
  const errCust = d1(`DELETE FROM customers WHERE id = '${CUSTOMER}';`, {
    expectFailure: true,
  });
  assert.match(errCust, /FOREIGN KEY|constraint|failed/i);
});

// --- 37 soft discard ---
run("Q: draft soft discard", () => {
  const draft = `${P}-draft-discard`;
  insertDraft(draft);
  d1(`UPDATE mail_drafts SET discarded_at = '${NOW}' WHERE id = '${draft}';`);
  d1(`UPDATE mail_drafts SET discarded_at = NULL WHERE id = '${draft}';`);
});

// --- revision customer association runtime ---
run("G: revision customer association runtime", () => {
  insertSnapshot(`${P}-snap-cust-rev`, SENDER_A);
  insertRevision(`${P}-rev-cust-ok`, {
    chainId: `${P}-chain-cust-rev`,
    signatureSnapshotId: `${P}-snap-cust-rev`,
    fromAddress: `${P}-sender-a@from.example.test`,
    customerId: CUSTOMER,
    customerAssociationType: "manual",
    customerAssociatedByUserId: null,
    customerAssociatedAt: NOW,
  });
  insertSnapshot(`${P}-snap-cust-rev-bad`, SENDER_A);
  const err = d1(
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, customer_id, content_hash, hash_version) VALUES ('${P}-rev-cust-bad', '${P}-chain-cust-bad', 1, 'staff_submit', '${USER}', '${NOW}', '${MAILBOX}', '${SENDER_A}', 'a@example.test', 'Subj', 'b', 'normal', 'new', '${P}-snap-cust-rev-bad', '${CUSTOMER}', 'h', 1);`,
    { expectFailure: true },
  );
  assert.match(err, /CHECK|constraint|failed/i);
});

console.log("\n=== Cleanup ===\n");
cleanup();

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`);
if (failed.length > 0) {
  for (const f of failed) console.error(`  FAIL: ${f.name} — ${f.detail}`);
  process.exit(1);
}
