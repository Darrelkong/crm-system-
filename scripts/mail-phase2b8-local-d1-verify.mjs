#!/usr/bin/env node
/**
 * Phase 2B.8 — Local D1 attachment storage + provenance runtime verification.
 * LOCAL ONLY: wrangler d1 execute crm-db --local
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOW = "2026-08-19T16:55:00.000Z";
const P = "mail-phase2b8";
const USER = `${P}-author`;
const USER_CREATOR = `${P}-creator`;
const MAILBOX = `${P}-mailbox`;
const SENDER = `${P}-sender`;
const CHAIN = `${P}-chain`;

const HASH_A = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HASH_B = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const HASH_C = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

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

function insertMailbox(id, address = `${id}@mbox.example.test`) {
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES (${q(id)}, ${q(address)}, 'Mbox', 'shared', 'active', ${q(NOW)}, ${q(NOW)});`);
}

function insertSender(id, mailboxId, address = `${id}@from.example.test`) {
  d1(`INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
      VALUES (${q(id)}, ${q(address)}, 'From', 'active', ${q(mailboxId)}, ${q(NOW)}, ${q(NOW)});`);
}

function insertSigVersion(id, senderId, versionNumber = 1) {
  d1(`INSERT INTO mail_signature_versions (id, sender_identity_id, version_number, body_text, is_active, created_at)
      VALUES (${q(id)}, ${q(senderId)}, ${versionNumber}, 'sig', 0, ${q(NOW)});`);
}

function insertSnapshot(id, senderId, snapshotHash = "snap-hash") {
  d1(`INSERT INTO mail_signature_snapshots (id, sender_identity_id, body_text, snapshot_hash, created_at)
      VALUES (${q(id)}, ${q(senderId)}, 'snap', ${q(snapshotHash)}, ${q(NOW)});`);
}

function insertStoredFile(id, {
  contentHash = HASH_A,
  storageKey = `${id}-storage-key`,
  originalFilename = "original.pdf",
  mimeType = "application/pdf",
  sizeBytes = 1024,
  createdByUserId = null,
  securityScanStatus = "unscanned",
  securityScannedAt = null,
} = {}) {
  d1(`INSERT INTO mail_stored_files (id, content_hash, original_filename, mime_type, size_bytes, storage_provider, storage_bucket, storage_key, created_by_user_id, security_scan_status, security_scanned_at, created_at)
      VALUES (${q(id)}, ${q(contentHash)}, ${q(originalFilename)}, ${q(mimeType)}, ${sizeBytes}, 'r2', 'fixture-bucket', ${q(storageKey)}, ${createdByUserId ? q(createdByUserId) : "NULL"}, ${q(securityScanStatus)}, ${securityScannedAt ? q(securityScannedAt) : "NULL"}, ${q(NOW)});`);
}

function insertDraft(id) {
  d1(`INSERT INTO mail_drafts (id, author_user_id, subject, body_text, sensitivity, compose_mode, autosave_version, last_saved_at, created_at, updated_at)
      VALUES (${q(id)}, ${q(USER)}, '', 'body', 'normal', 'new', 0, ${q(NOW)}, ${q(NOW)}, ${q(NOW)});`);
}

function insertRevision(id, snapshotId, chainId = CHAIN) {
  d1(`INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version)
      VALUES (${q(id)}, ${q(chainId)}, 1, 'staff_submit', ${q(USER)}, ${q(NOW)}, ${q(MAILBOX)}, ${q(SENDER)}, 'from@example.test', 'Subject', 'body', 'normal', 'new', ${q(snapshotId)}, 'rev-content-hash', 1);`);
}

function insertThread(id) {
  d1(`INSERT INTO mail_threads (id, mailbox_id, subject_normalized, last_message_at, created_at, updated_at)
      VALUES (${q(id)}, ${q(MAILBOX)}, 'subj', ${q(NOW)}, ${q(NOW)}, ${q(NOW)});`);
}

function insertInboundMessage(id, threadId) {
  d1(`INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, received_at, created_at, updated_at)
      VALUES (${q(id)}, ${q(threadId)}, ${q(MAILBOX)}, 'inbound', 'sender@example.test', 'Subject', ${q(NOW)}, ${q(NOW)}, ${q(NOW)});`);
}

function insertDraftAttachment(id, draftId, fileId, opts = {}) {
  const {
    displayFilename = "display.pdf",
    deliveryMode = "direct_attachment",
    secureExpiryDays = null,
    sortOrder = 0,
  } = opts;
  d1(`INSERT INTO mail_draft_attachments (id, draft_id, stored_file_id, display_filename, sort_order, delivery_mode, secure_expiry_days, created_at, updated_at)
      VALUES (${q(id)}, ${q(draftId)}, ${q(fileId)}, ${q(displayFilename)}, ${sortOrder}, ${q(deliveryMode)}, ${secureExpiryDays ?? "NULL"}, ${q(NOW)}, ${q(NOW)});`);
}

function insertRevAttachment(id, revisionId, fileId, contentHash, opts = {}) {
  const {
    displayFilename = "display.pdf",
    originalFilename = "original.pdf",
    mimeType = "application/pdf",
    sizeBytes = 1024,
    deliveryMode = "direct_attachment",
    secureExpiryDays = null,
    sortOrder = 0,
  } = opts;
  d1(`INSERT INTO mail_outbound_revision_attachments (id, revision_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, secure_expiry_days, created_at)
      VALUES (${q(id)}, ${q(revisionId)}, ${q(fileId)}, ${q(contentHash)}, ${q(originalFilename)}, ${q(displayFilename)}, ${q(mimeType)}, ${sizeBytes}, ${sortOrder}, ${q(deliveryMode)}, ${secureExpiryDays ?? "NULL"}, ${q(NOW)});`);
}

function insertMsgAttachment(id, messageId, fileId, contentHash, opts = {}) {
  const {
    sourceRevisionAttachmentId = null,
    displayFilename = "display.pdf",
    originalFilename = "original.pdf",
    mimeType = "application/pdf",
    sizeBytes = 1024,
    deliveryMode = "direct_attachment",
    secureExpiryDays = null,
    sortOrder = 0,
  } = opts;
  d1(`INSERT INTO mail_message_attachments (id, message_id, stored_file_id, source_revision_attachment_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, secure_expiry_days, created_at)
      VALUES (${q(id)}, ${q(messageId)}, ${q(fileId)}, ${sourceRevisionAttachmentId ? q(sourceRevisionAttachmentId) : "NULL"}, ${q(contentHash)}, ${q(originalFilename)}, ${q(displayFilename)}, ${q(mimeType)}, ${sizeBytes}, ${sortOrder}, ${q(deliveryMode)}, ${secureExpiryDays ?? "NULL"}, ${q(NOW)});`);
}

function insertSigVersionAsset(id, versionId, fileId, contentHash, assetRef = "company-logo") {
  d1(`INSERT INTO mail_signature_version_assets (id, signature_version_id, stored_file_id, content_hash, asset_ref, mime_type, size_bytes, sort_order, created_at)
      VALUES (${q(id)}, ${q(versionId)}, ${q(fileId)}, ${q(contentHash)}, ${q(assetRef)}, 'image/png', 512, 0, ${q(NOW)});`);
}

function insertSigSnapshotAsset(id, snapshotId, fileId, contentHash, assetRef = "company-logo") {
  d1(`INSERT INTO mail_signature_snapshot_assets (id, signature_snapshot_id, stored_file_id, content_hash, asset_ref, mime_type, size_bytes, sort_order, created_at)
      VALUES (${q(id)}, ${q(snapshotId)}, ${q(fileId)}, ${q(contentHash)}, ${q(assetRef)}, 'image/png', 512, 0, ${q(NOW)});`);
}

function reject(err) {
  assert.match(err, /CHECK|constraint|failed|UNIQUE|FOREIGN KEY/i);
}

function setupCore() {
  insertUser(USER);
  insertMailbox(MAILBOX);
  insertSender(SENDER, MAILBOX);
}

function cleanup() {
  const stmts = [
    `DELETE FROM mail_message_attachments WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_revision_attachments WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_draft_attachments WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_snapshot_assets WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_version_assets WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_revisions WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_messages WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_threads WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_snapshots WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_versions WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_drafts WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_stored_files WHERE id LIKE '${P}%';`,
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

console.log("=== Phase 2B.8 Local D1 Attachment Storage Verification ===\n");

run("D: six 0055 tables exist", () => {
  const out = d1(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mail_stored_files','mail_draft_attachments','mail_outbound_revision_attachments','mail_message_attachments','mail_signature_version_assets','mail_signature_snapshot_assets') ORDER BY name;`,
  );
  for (const t of [
    "mail_draft_attachments",
    "mail_message_attachments",
    "mail_outbound_revision_attachments",
    "mail_signature_snapshot_assets",
    "mail_signature_version_assets",
    "mail_stored_files",
  ]) {
    assert.match(out, new RegExp(t));
  }
});

run("D: migration 55 applied", () => {
  const out = d1(`SELECT id, name FROM d1_migrations WHERE id = 55;`);
  assert.match(out, /0055_mail_attachment_storage/);
});

run("D: authored indexes present", () => {
  const out = d1(
    `SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_mail_stored%' OR name LIKE 'uq_mail_stored%' OR name LIKE 'idx_mail_draft_attach%' OR name LIKE 'idx_mail_outbound_revision_attach%' OR name LIKE 'idx_mail_message_attach%' OR name LIKE 'idx_mail_signature_%_assets%') ORDER BY name;`,
  );
  for (const idx of [
    "idx_mail_stored_files_content_hash",
    "uq_mail_stored_files_storage_key",
    "idx_mail_stored_files_created_by",
    "idx_mail_draft_attachments_draft_id",
    "idx_mail_outbound_revision_attachments_revision_id",
    "idx_mail_outbound_revision_attachments_stored_file_id",
    "idx_mail_message_attachments_message_id",
    "idx_mail_message_attachments_stored_file_id",
    "idx_mail_message_attachments_source_revision_attachment",
    "idx_mail_signature_version_assets_version_id",
    "idx_mail_signature_snapshot_assets_snapshot_id",
  ]) {
    assert.match(out, new RegExp(idx), `missing ${idx}`);
  }
});

run("Q: SQL-Drizzle parity spot-check", () => {
  const sql = readFileSync(
    join(process.cwd(), "drizzle/migrations/0055_mail_attachment_storage.sql"),
    "utf8",
  );
  const storedSql = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_stored_files';`,
  );
  assert.match(sql, /FOREIGN KEY \(stored_file_id, content_hash\)/);
  assert.match(storedSql, /content_hash NOT GLOB/);
  assert.match(storedSql, /security_scan_status = 'unscanned'/);
  const msgSql = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_message_attachments';`,
  );
  assert.match(msgSql, /source_revision_attachment_id, stored_file_id, content_hash/);
});

run("R: canonical hash documentation in migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "drizzle/migrations/0055_mail_attachment_storage.sql"),
    "utf8",
  );
  assert.match(sql, /EXCLUDED from external hash: stored_file_id/i);
  assert.match(sql, /CANONICAL HASH V1 ALGORITHM: NOT YET FROZEN/i);
});

run("P: private storage — no URL columns in schema", () => {
  for (const table of [
    "mail_stored_files",
    "mail_draft_attachments",
    "mail_outbound_revision_attachments",
    "mail_message_attachments",
    "mail_signature_version_assets",
    "mail_signature_snapshot_assets",
  ]) {
    const block = d1(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}';`);
    for (const col of ["public_url", "download_url", "signed_url", "presigned_url"]) {
      assert.doesNotMatch(block, new RegExp(col, "i"));
    }
  }
});

setupCore();

run("E: valid stored file with SHA-256 passes", () => {
  const id = `${P}-file-valid`;
  insertStoredFile(id, { contentHash: HASH_A, storageKey: `${id}-key` });
  const out = d1(`SELECT content_hash, storage_provider, storage_bucket, storage_key, size_bytes FROM mail_stored_files WHERE id='${id}';`);
  assert.match(out, new RegExp(HASH_A));
  assert.match(out, /r2/);
  assert.match(out, /fixture-bucket/);
});

run("F: SHA-256 format runtime rejects malformed hashes", () => {
  const cases = [
    ["63-char", HASH_A.slice(0, 63)],
    ["65-char", HASH_A + "a"],
    ["uppercase", HASH_A.toUpperCase()],
    ["non-hex-g", HASH_A.slice(0, 63) + "g"],
    ["dash", HASH_A.slice(0, 62) + "-a"],
    ["space", HASH_A.slice(0, 62) + " a"],
    ["mixed-invalid", HASH_A.slice(0, 32) + "Z" + HASH_A.slice(33)],
  ];
  for (const [label, badHash] of cases) {
    const err = d1(
      `INSERT INTO mail_stored_files (id, content_hash, original_filename, mime_type, size_bytes, storage_provider, storage_bucket, storage_key, created_at) VALUES ('${P}-bad-${label}', ${q(badHash)}, 'f.pdf', 'application/pdf', 1, 'r2', 'b', '${P}-bad-${label}-key', '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
  insertStoredFile(`${P}-file-accept-hex`, { contentHash: HASH_B, storageKey: `${P}-accept-key` });
});

run("E: content_hash not globally unique", () => {
  insertStoredFile(`${P}-file-dup-a`, { contentHash: HASH_A, storageKey: `${P}-dup-a-key` });
  insertStoredFile(`${P}-file-dup-b`, { contentHash: HASH_A, storageKey: `${P}-dup-b-key` });
});

run("E: storage_key unique — same key rejected", () => {
  const key = `${P}-same-key`;
  insertStoredFile(`${P}-file-key-a`, { contentHash: HASH_B, storageKey: key });
  const err = d1(
    `INSERT INTO mail_stored_files (id, content_hash, original_filename, mime_type, size_bytes, storage_provider, storage_bucket, storage_key, created_at) VALUES ('${P}-file-key-b', ${q(HASH_C)}, 'f.pdf', 'application/pdf', 1, 'r2', 'b', ${q(key)}, '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
});

run("E: size_bytes bounds", () => {
  insertStoredFile(`${P}-file-size-0`, { contentHash: HASH_C, storageKey: `${P}-size-0`, sizeBytes: 0 });
  insertStoredFile(`${P}-file-size-pos`, { contentHash: HASH_B, storageKey: `${P}-size-pos`, sizeBytes: 999 });
  const err = d1(
    `INSERT INTO mail_stored_files (id, content_hash, original_filename, mime_type, size_bytes, storage_provider, storage_bucket, storage_key, created_at) VALUES ('${P}-file-size-neg', ${q(HASH_A)}, 'f.pdf', 'application/pdf', -1, 'r2', 'b', '${P}-size-neg', '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
});

run("G: security scan lifecycle runtime", () => {
  insertStoredFile(`${P}-scan-unscanned`, { contentHash: HASH_A, storageKey: `${P}-scan-unscanned` });
  const errB = d1(
    `INSERT INTO mail_stored_files (id, content_hash, original_filename, mime_type, size_bytes, storage_provider, storage_bucket, storage_key, security_scan_status, security_scanned_at, created_at) VALUES ('${P}-scan-bad', ${q(HASH_B)}, 'f.pdf', 'application/pdf', 1, 'r2', 'b', '${P}-scan-bad', 'unscanned', '${NOW}', '${NOW}');`,
    { expectFailure: true },
  );
  reject(errB);
  for (const status of ["clean", "blocked", "scan_failed"]) {
    insertStoredFile(`${P}-scan-${status}`, {
      contentHash: HASH_B,
      storageKey: `${P}-scan-${status}`,
      securityScanStatus: status,
      securityScannedAt: NOW,
    });
  }
  for (const status of ["clean", "blocked", "scan_failed"]) {
    const err = d1(
      `INSERT INTO mail_stored_files (id, content_hash, original_filename, mime_type, size_bytes, storage_provider, storage_bucket, storage_key, security_scan_status, created_at) VALUES ('${P}-scan-null-${status}', ${q(HASH_C)}, 'f.pdf', 'application/pdf', 1, 'r2', 'b', '${P}-sn-${status}', '${status}', '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
  const errInvalid = d1(
    `INSERT INTO mail_stored_files (id, content_hash, original_filename, mime_type, size_bytes, storage_provider, storage_bucket, storage_key, security_scan_status, created_at) VALUES ('${P}-scan-invalid', ${q(HASH_A)}, 'f.pdf', 'application/pdf', 1, 'r2', 'b', '${P}-scan-invalid', 'pending', '${NOW}');`,
    { expectFailure: true },
  );
  reject(errInvalid);
});

run("H: draft attachment basic", () => {
  const draft = `${P}-draft`;
  const file = `${P}-file-draft`;
  insertDraft(draft);
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  insertDraftAttachment(`${P}-da-basic`, draft, file);
});

run("I: direct attachment policy — draft/revision/message", () => {
  const file = `${P}-file-policy`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const draft = `${P}-draft-direct`;
  insertDraft(draft);
  insertDraftAttachment(`${P}-da-direct`, draft, file, { deliveryMode: "direct_attachment" });
  for (const days of [1, 3, 7]) {
    const err = d1(
      `INSERT INTO mail_draft_attachments (id, draft_id, stored_file_id, display_filename, sort_order, delivery_mode, secure_expiry_days, created_at, updated_at) VALUES ('${P}-da-direct-bad-${days}', ${q(draft)}, ${q(file)}, 'f.pdf', 0, 'direct_attachment', ${days}, '${NOW}', '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
  const snap = `${P}-snap-direct`;
  const rev = `${P}-rev-direct`;
  insertSnapshot(snap, SENDER);
  insertRevision(rev, snap, `${P}-chain-direct`);
  insertRevAttachment(`${P}-ra-direct`, rev, file, HASH_A);
  const errRev = d1(
    `INSERT INTO mail_outbound_revision_attachments (id, revision_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, secure_expiry_days, created_at) VALUES ('${P}-ra-direct-bad', ${q(rev)}, ${q(file)}, ${q(HASH_A)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'direct_attachment', 7, '${NOW}');`,
    { expectFailure: true },
  );
  reject(errRev);
  const thread = `${P}-thread-direct`;
  const msg = `${P}-msg-direct`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  insertMsgAttachment(`${P}-ma-direct`, msg, file, HASH_A);
  const errMsg = d1(
    `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, secure_expiry_days, created_at) VALUES ('${P}-ma-direct-bad', ${q(msg)}, ${q(file)}, ${q(HASH_A)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'direct_attachment', 3, '${NOW}');`,
    { expectFailure: true },
  );
  reject(errMsg);
});

run("I: secure file policy — draft/revision/message", () => {
  const file = `${P}-file-secure`;
  insertStoredFile(file, { contentHash: HASH_B, storageKey: `${file}-key` });
  const draft = `${P}-draft-secure`;
  insertDraft(draft);
  for (const days of [1, 3, 7]) {
    insertDraftAttachment(`${P}-da-sec-${days}`, draft, file, {
      deliveryMode: "secure_file",
      secureExpiryDays: days,
    });
  }
  for (const bad of [null, 0, 2, 5, 30]) {
    const val = bad === null ? "NULL" : bad;
    const err = d1(
      `INSERT INTO mail_draft_attachments (id, draft_id, stored_file_id, display_filename, sort_order, delivery_mode, secure_expiry_days, created_at, updated_at) VALUES ('${P}-da-sec-bad-${bad ?? "null"}', ${q(draft)}, ${q(file)}, 'f.pdf', 0, 'secure_file', ${val}, '${NOW}', '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
});

run("2B.8.1-A: revision attachment secure_file policy", () => {
  const file = `${P}-file-rev-sec`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const snap = `${P}-snap-rev-sec`;
  const rev = `${P}-rev-sec`;
  insertSnapshot(snap, SENDER, "hr-rev-sec");
  insertRevision(rev, snap, `${P}-chain-rev-sec`);
  for (const days of [1, 3, 7]) {
    insertRevAttachment(`${P}-ra-sec-${days}`, rev, file, HASH_A, {
      deliveryMode: "secure_file",
      secureExpiryDays: days,
    });
  }
  for (const bad of [null, 0, 2, 5, 30]) {
    const val = bad === null ? "NULL" : bad;
    const err = d1(
      `INSERT INTO mail_outbound_revision_attachments (id, revision_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, secure_expiry_days, created_at) VALUES ('${P}-ra-sec-bad-${bad ?? "null"}', ${q(rev)}, ${q(file)}, ${q(HASH_A)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'secure_file', ${val}, '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
});

run("2B.8.1-B: message attachment secure_file policy", () => {
  const file = `${P}-file-msg-sec`;
  insertStoredFile(file, { contentHash: HASH_B, storageKey: `${file}-key` });
  const thread = `${P}-thread-msg-sec`;
  const msg = `${P}-msg-sec`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  for (const days of [1, 3, 7]) {
    insertMsgAttachment(`${P}-ma-sec-${days}`, msg, file, HASH_B, {
      deliveryMode: "secure_file",
      secureExpiryDays: days,
    });
  }
  for (const bad of [null, 0, 2, 5, 30]) {
    const val = bad === null ? "NULL" : bad;
    const err = d1(
      `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, secure_expiry_days, created_at) VALUES ('${P}-ma-sec-bad-${bad ?? "null"}', ${q(msg)}, ${q(file)}, ${q(HASH_B)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'secure_file', ${val}, '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
});

run("2B.8.1-C: revision attachment display_filename CHECK", () => {
  const file = `${P}-file-rev-df`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const snap = `${P}-snap-rev-df`;
  const rev = `${P}-rev-df`;
  insertSnapshot(snap, SENDER, "hr-rev-df");
  insertRevision(rev, snap, `${P}-chain-rev-df`);
  insertRevAttachment(`${P}-ra-df-ok`, rev, file, HASH_A, { displayFilename: "valid.pdf" });
  for (const bad of ["", "   "]) {
    const err = d1(
      `INSERT INTO mail_outbound_revision_attachments (id, revision_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ra-df-bad', ${q(rev)}, ${q(file)}, ${q(HASH_A)}, 'o.pdf', ${q(bad)}, 'application/pdf', 1, 0, 'direct_attachment', '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
});

run("2B.8.1-D: message attachment display_filename CHECK", () => {
  const file = `${P}-file-msg-df`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const thread = `${P}-thread-msg-df`;
  const msg = `${P}-msg-df`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  insertMsgAttachment(`${P}-ma-df-ok`, msg, file, HASH_A, { displayFilename: "valid.pdf" });
  for (const bad of ["", "   "]) {
    const err = d1(
      `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ma-df-bad', ${q(msg)}, ${q(file)}, ${q(HASH_A)}, 'o.pdf', ${q(bad)}, 'application/pdf', 1, 0, 'direct_attachment', '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
});

run("2B.8.1-E: invalid delivery_mode revision/message", () => {
  const file = `${P}-file-badmode`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const snap = `${P}-snap-badmode`;
  const rev = `${P}-rev-badmode`;
  insertSnapshot(snap, SENDER, "hr-badmode");
  insertRevision(rev, snap, `${P}-chain-badmode`);
  const errRev = d1(
    `INSERT INTO mail_outbound_revision_attachments (id, revision_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ra-badmode', ${q(rev)}, ${q(file)}, ${q(HASH_A)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'invalid_mode', '${NOW}');`,
    { expectFailure: true },
  );
  reject(errRev);
  const thread = `${P}-thread-badmode`;
  const msg = `${P}-msg-badmode`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  const errMsg = d1(
    `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ma-badmode', ${q(msg)}, ${q(file)}, ${q(HASH_A)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'invalid_mode', '${NOW}');`,
    { expectFailure: true },
  );
  reject(errMsg);
});

run("2B.8.1-F: revision/message original_filename CHECK", () => {
  const file = `${P}-file-origfn`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const snap = `${P}-snap-origfn`;
  const rev = `${P}-rev-origfn`;
  insertSnapshot(snap, SENDER, "hr-origfn");
  insertRevision(rev, snap, `${P}-chain-origfn`);
  insertRevAttachment(`${P}-ra-origfn-ok`, rev, file, HASH_A, { originalFilename: "valid.pdf" });
  for (const bad of ["", "   "]) {
    const errRev = d1(
      `INSERT INTO mail_outbound_revision_attachments (id, revision_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ra-origfn-bad', ${q(rev)}, ${q(file)}, ${q(HASH_A)}, ${q(bad)}, 'd.pdf', 'application/pdf', 1, 0, 'direct_attachment', '${NOW}');`,
      { expectFailure: true },
    );
    reject(errRev);
  }
  const thread = `${P}-thread-origfn`;
  const msg = `${P}-msg-origfn`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  insertMsgAttachment(`${P}-ma-origfn-ok`, msg, file, HASH_A, { originalFilename: "valid.pdf" });
  for (const bad of ["", "   "]) {
    const errMsg = d1(
      `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ma-origfn-bad', ${q(msg)}, ${q(file)}, ${q(HASH_A)}, ${q(bad)}, 'd.pdf', 'application/pdf', 1, 0, 'direct_attachment', '${NOW}');`,
      { expectFailure: true },
    );
    reject(errMsg);
  }
});

run("H: display_filename nonblank CHECK", () => {
  const draft = `${P}-draft-dfname`;
  const file = `${P}-file-dfname`;
  insertDraft(draft);
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  for (const bad of ["", "   "]) {
    const err = d1(
      `INSERT INTO mail_draft_attachments (id, draft_id, stored_file_id, display_filename, sort_order, delivery_mode, created_at, updated_at) VALUES ('${P}-da-badname', ${q(draft)}, ${q(file)}, ${q(bad)}, 0, 'direct_attachment', '${NOW}', '${NOW}');`,
      { expectFailure: true },
    );
    reject(err);
  }
  insertDraftAttachment(`${P}-da-goodname`, draft, file, { displayFilename: "valid.pdf" });
});

run("H: draft duplicate stored file allowed", () => {
  const draft = `${P}-draft-dup`;
  const file = `${P}-file-dup-draft`;
  insertDraft(draft);
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  insertDraftAttachment(`${P}-da-dup1`, draft, file);
  insertDraftAttachment(`${P}-da-dup2`, draft, file, { sortOrder: 1 });
  const draft2 = `${P}-draft-dup2`;
  insertDraft(draft2);
  insertDraftAttachment(`${P}-da-dup-other`, draft2, file);
});

run("J: signature version asset valid provenance", () => {
  const ver = `${P}-sigver`;
  const file = `${P}-file-sigver`;
  insertSigVersion(ver, SENDER);
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  insertSigVersionAsset(`${P}-sva-ok`, ver, file, HASH_A);
});

run("J: signature version asset hash mismatch rejected", () => {
  const ver = `${P}-sigver-mismatch`;
  insertSigVersion(ver, SENDER, 2);
  insertStoredFile(`${P}-file-a`, { contentHash: HASH_A, storageKey: `${P}-file-a-key` });
  insertStoredFile(`${P}-file-b`, { contentHash: HASH_B, storageKey: `${P}-file-b-key` });
  const err = d1(
    `INSERT INTO mail_signature_version_assets (id, signature_version_id, stored_file_id, content_hash, asset_ref, mime_type, size_bytes, sort_order, created_at) VALUES ('${P}-sva-bad', ${q(ver)}, '${P}-file-a', ${q(HASH_B)}, 'logo', 'image/png', 1, 0, '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
});

run("J: signature version asset_ref unique per version", () => {
  const ver = `${P}-sigver-ref`;
  insertSigVersion(ver, SENDER, 3);
  const file = `${P}-file-ref`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  insertSigVersionAsset(`${P}-sva-ref1`, ver, file, HASH_A, "company-logo");
  const err = d1(
    `INSERT INTO mail_signature_version_assets (id, signature_version_id, stored_file_id, content_hash, asset_ref, mime_type, size_bytes, sort_order, created_at) VALUES ('${P}-sva-ref2', ${q(ver)}, ${q(file)}, ${q(HASH_A)}, 'company-logo', 'image/png', 1, 1, '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
  const ver2 = `${P}-sigver-ref2`;
  insertSigVersion(ver2, SENDER, 4);
  insertSigVersionAsset(`${P}-sva-ref-other`, ver2, file, HASH_A, "company-logo");
});

run("K: signature snapshot asset valid freeze", () => {
  const snap = `${P}-snap-asset`;
  const file = `${P}-file-snap-asset`;
  insertSnapshot(snap, SENDER);
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  insertSigSnapshotAsset(`${P}-ssa-ok`, snap, file, HASH_A);
  const block = d1(`SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_signature_snapshot_assets';`);
  assert.doesNotMatch(block, /updated_at/i);
});

run("K: signature snapshot asset hash mismatch rejected", () => {
  const snap = `${P}-snap-mismatch`;
  insertSnapshot(snap, SENDER, "hash2");
  insertStoredFile(`${P}-file-sa`, { contentHash: HASH_A, storageKey: `${P}-file-sa-key` });
  const err = d1(
    `INSERT INTO mail_signature_snapshot_assets (id, signature_snapshot_id, stored_file_id, content_hash, asset_ref, mime_type, size_bytes, sort_order, created_at) VALUES ('${P}-ssa-bad', ${q(snap)}, '${P}-file-sa', ${q(HASH_B)}, 'logo', 'image/png', 1, 0, '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
});

run("K: signature snapshot asset_ref unique per snapshot", () => {
  const snap = `${P}-snap-ref`;
  insertSnapshot(snap, SENDER, "hash3");
  const file = `${P}-file-ss-ref`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  insertSigSnapshotAsset(`${P}-ssa-ref1`, snap, file, HASH_A, "banner");
  const err = d1(
    `INSERT INTO mail_signature_snapshot_assets (id, signature_snapshot_id, stored_file_id, content_hash, asset_ref, mime_type, size_bytes, sort_order, created_at) VALUES ('${P}-ssa-ref2', ${q(snap)}, ${q(file)}, ${q(HASH_A)}, 'banner', 'image/png', 1, 1, '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
  const snap2 = `${P}-snap-ref2`;
  insertSnapshot(snap2, SENDER, "hash4");
  insertSigSnapshotAsset(`${P}-ssa-ref-other`, snap2, file, HASH_A, "banner");
});

run("J/K: signature asset same file reuse across versions/snapshots", () => {
  const file = `${P}-file-reuse`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const v1 = `${P}-sigver-r1`;
  const v2 = `${P}-sigver-r2`;
  insertSigVersion(v1, SENDER, 10);
  insertSigVersion(v2, SENDER, 11);
  insertSigVersionAsset(`${P}-sva-r1`, v1, file, HASH_A, "logo-r1");
  insertSigVersionAsset(`${P}-sva-r2`, v2, file, HASH_A, "logo-r2");
  const s1 = `${P}-snap-r1`;
  const s2 = `${P}-snap-r2`;
  insertSnapshot(s1, SENDER, "hr1");
  insertSnapshot(s2, SENDER, "hr2");
  insertSigSnapshotAsset(`${P}-ssa-r1`, s1, file, HASH_A, "logo-s1");
  insertSigSnapshotAsset(`${P}-ssa-r2`, s2, file, HASH_A, "logo-s2");
});

run("L: revision attachment valid provenance", () => {
  const file = `${P}-file-rev`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key`, originalFilename: "orig-rev.pdf" });
  const snap = `${P}-snap-rev`;
  const rev = `${P}-rev-att`;
  insertSnapshot(snap, SENDER, "hr-rev");
  insertRevision(rev, snap, `${P}-chain-rev`);
  insertRevAttachment(`${P}-ra-ok`, rev, file, HASH_A, {
    originalFilename: "orig-rev.pdf",
    displayFilename: "disp-rev.pdf",
    deliveryMode: "secure_file",
    secureExpiryDays: 7,
  });
  const block = d1(`SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_outbound_revision_attachments';`);
  assert.doesNotMatch(block, /updated_at/i);
});

run("L: revision attachment hash mismatch rejected", () => {
  const file = `${P}-file-rev-mm`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const snap = `${P}-snap-rev-mm`;
  const rev = `${P}-rev-mm`;
  insertSnapshot(snap, SENDER, "hr-mm");
  insertRevision(rev, snap, `${P}-chain-mm`);
  const err = d1(
    `INSERT INTO mail_outbound_revision_attachments (id, revision_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ra-mm', ${q(rev)}, '${P}-file-rev-mm', ${q(HASH_B)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'direct_attachment', '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
});

run("M: inbound message attachment without revision source", () => {
  const file = `${P}-file-inbound`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const thread = `${P}-thread-in`;
  const msg = `${P}-msg-in`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  insertMsgAttachment(`${P}-ma-in`, msg, file, HASH_A);
});

run("M: message attachment stored file hash mismatch rejected", () => {
  const file = `${P}-file-msg-mm`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const thread = `${P}-thread-msg-mm`;
  const msg = `${P}-msg-mm`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  const err = d1(
    `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ma-mm', ${q(msg)}, ${q(file)}, ${q(HASH_B)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'direct_attachment', '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
});

run("N: revision to message attachment provenance pass", () => {
  const file = `${P}-file-prov`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const snap = `${P}-snap-prov`;
  const rev = `${P}-rev-prov`;
  insertSnapshot(snap, SENDER, "hr-prov");
  insertRevision(rev, snap, `${P}-chain-prov`);
  const ra = `${P}-ra-prov`;
  insertRevAttachment(ra, rev, file, HASH_A);
  const thread = `${P}-thread-prov`;
  const msg = `${P}-msg-prov`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  insertMsgAttachment(`${P}-ma-prov`, msg, file, HASH_A, { sourceRevisionAttachmentId: ra });
});

run("N: revision to message file substitution attack rejected", () => {
  const fileA = `${P}-file-sub-a`;
  const fileB = `${P}-file-sub-b`;
  insertStoredFile(fileA, { contentHash: HASH_A, storageKey: `${fileA}-key` });
  insertStoredFile(fileB, { contentHash: HASH_B, storageKey: `${fileB}-key` });
  const snap = `${P}-snap-sub`;
  const rev = `${P}-rev-sub`;
  insertSnapshot(snap, SENDER, "hr-sub");
  insertRevision(rev, snap, `${P}-chain-sub`);
  const ra = `${P}-ra-sub`;
  insertRevAttachment(ra, rev, fileA, HASH_A);
  const thread = `${P}-thread-sub`;
  const msg = `${P}-msg-sub`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  const errSubst = d1(
    `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, source_revision_attachment_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ma-sub', ${q(msg)}, ${q(fileB)}, ${q(ra)}, ${q(HASH_B)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'direct_attachment', '${NOW}');`,
    { expectFailure: true },
  );
  reject(errSubst);
});

run("N: revision source id with wrong hash rejected", () => {
  const file = `${P}-file-wronghash`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const snap = `${P}-snap-wronghash`;
  const rev = `${P}-rev-wronghash`;
  insertSnapshot(snap, SENDER, "hr-wh");
  insertRevision(rev, snap, `${P}-chain-wh`);
  const ra = `${P}-ra-wronghash`;
  insertRevAttachment(ra, rev, file, HASH_A);
  const thread = `${P}-thread-wh`;
  const msg = `${P}-msg-wh`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  const err = d1(
    `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, source_revision_attachment_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at) VALUES ('${P}-ma-wh', ${q(msg)}, ${q(file)}, ${q(ra)}, ${q(HASH_B)}, 'o.pdf', 'd.pdf', 'application/pdf', 1, 0, 'direct_attachment', '${NOW}');`,
    { expectFailure: true },
  );
  reject(err);
});

run("O: FK retention — cannot delete referenced stored files", () => {
  const file = `${P}-file-fk`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key` });
  const ver = `${P}-sigver-fk`;
  insertSigVersion(ver, SENDER, 20);
  insertSigVersionAsset(`${P}-sva-fk`, ver, file, HASH_A, "fk-logo");
  const snap = `${P}-snap-fk`;
  insertSnapshot(snap, SENDER, "hr-fk");
  insertSigSnapshotAsset(`${P}-ssa-fk`, snap, file, HASH_A, "fk-snap");
  const rev = `${P}-rev-fk`;
  insertRevision(rev, snap, `${P}-chain-fk`);
  insertRevAttachment(`${P}-ra-fk`, rev, file, HASH_A);
  const thread = `${P}-thread-fk`;
  const msg = `${P}-msg-fk`;
  insertThread(thread);
  insertInboundMessage(msg, thread);
  insertMsgAttachment(`${P}-ma-fk`, msg, file, HASH_A);
  const err = d1(`DELETE FROM mail_stored_files WHERE id = '${file}';`, { expectFailure: true });
  reject(err);
  assert.doesNotMatch(
    readFileSync(join(process.cwd(), "drizzle/migrations/0055_mail_attachment_storage.sql"), "utf8"),
    /ON DELETE CASCADE/i,
  );
});

run("O: created_by_user_id ON DELETE SET NULL", () => {
  insertUser(USER_CREATOR);
  const file = `${P}-file-creator`;
  insertStoredFile(file, {
    contentHash: HASH_B,
    storageKey: `${file}-key`,
    createdByUserId: USER_CREATOR,
  });
  d1(`DELETE FROM users WHERE id = '${USER_CREATOR}';`);
  const out = d1(`SELECT created_by_user_id, content_hash FROM mail_stored_files WHERE id='${file}';`);
  assert.match(out, /null/i);
  assert.match(out, new RegExp(HASH_B));
});

run("P: original vs display filename separation", () => {
  const file = `${P}-file-names`;
  insertStoredFile(file, { contentHash: HASH_A, storageKey: `${file}-key`, originalFilename: "stored-original.pdf" });
  const draft = `${P}-draft-names`;
  insertDraft(draft);
  insertDraftAttachment(`${P}-da-names`, draft, file, { displayFilename: "user-renamed.pdf" });
  const out = d1(`SELECT original_filename FROM mail_stored_files WHERE id='${file}';`);
  assert.match(out, /stored-original\.pdf/);
});

console.log("\n=== Cleanup ===\n");
cleanup();

run("S: fixture cleanup — zero mail-phase2b8 rows", () => {
  const tables = [
    ["users", "id"],
    ["mail_mailboxes", "id"],
    ["mail_sender_identities", "id"],
    ["mail_messages", "id"],
    ["mail_drafts", "id"],
    ["mail_signature_versions", "id"],
    ["mail_signature_snapshots", "id"],
    ["mail_outbound_revisions", "id"],
    ["mail_stored_files", "id"],
    ["mail_draft_attachments", "id"],
    ["mail_outbound_revision_attachments", "id"],
    ["mail_message_attachments", "id"],
    ["mail_signature_version_assets", "id"],
    ["mail_signature_snapshot_assets", "id"],
  ];
  for (const [table, col] of tables) {
    const out = d1(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} LIKE '${P}%';`);
    assert.match(out, /"c":\s*0|"c":0/);
  }
});

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`);
if (failed.length > 0) {
  for (const f of failed) console.error(`  FAIL: ${f.name} — ${f.detail}`);
  process.exit(1);
}
