#!/usr/bin/env node
/**
 * Phase 2B.11 — Local D1 Staff outbound Approval runtime verification.
 * LOCAL ONLY: wrangler d1 execute + getPlatformProxy env.DB.batch().
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NOW = "2026-08-19T17:00:00.000Z";
const RESOLVED = "2026-08-19T17:05:00.000Z";
const P = "mail-phase2b11";
const USER = `${P}-staff`;
const ADMIN = `${P}-admin`;
const MAILBOX = `${P}-mailbox`;
const SENDER = `${P}-sender`;
const SNAP = `${P}-snap`;

const HASH_1 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HASH_2 =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const HASH_3 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const results = [];
const batchObservations = [];

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

function reject(err) {
  assert.match(err, /CHECK|constraint|failed|UNIQUE|FOREIGN KEY|NOT NULL/i);
}

function insertUser(id, email = `${id}@example.test`) {
  d1(`INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
      VALUES (${q(id)}, ${q(email)}, 'Fixture', 'hash', 'staff', 1, 0, 0, 0, ${q(NOW)}, ${q(NOW)});`);
}

function insertMailbox(id) {
  d1(`INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
      VALUES (${q(id)}, ${q(`${id}@mbox.test`)}, 'Mbox', 'shared', 'active', ${q(NOW)}, ${q(NOW)});`);
}

function insertSender(id, mailboxId) {
  d1(`INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
      VALUES (${q(id)}, ${q(`${id}@from.test`)}, 'From', 'active', ${q(mailboxId)}, ${q(NOW)}, ${q(NOW)});`);
}

function insertSnapshot(id, senderId) {
  d1(`INSERT INTO mail_signature_snapshots (id, sender_identity_id, body_text, snapshot_hash, created_at)
      VALUES (${q(id)}, ${q(senderId)}, 'snap', 'snap-hash', ${q(NOW)});`);
}

function insertRevision(id, chainId, revisionNumber, contentHash, opts = {}) {
  const {
    parentRevisionId = null,
    revisionKind = "staff_submit",
  } = opts;
  const snapshotId = `${id}-snap`;
  insertSnapshot(snapshotId, SENDER);
  d1(`INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, parent_revision_id, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version)
      VALUES (${q(id)}, ${q(chainId)}, ${revisionNumber}, ${parentRevisionId ? q(parentRevisionId) : "NULL"}, ${q(revisionKind)}, ${q(USER)}, ${q(NOW)}, ${q(MAILBOX)}, ${q(SENDER)}, 'from@test', 'Subject', 'body', 'normal', 'new', ${q(snapshotId)}, ${q(contentHash)}, 1);`);
}

function insertApproval(id, chainId, revId, contentHash, opts = {}) {
  const {
    status = "pending",
    priority = "normal",
    workflowVersion = 1,
    approvedRevId = null,
    approvedHash = null,
    approvedHashVersion = null,
    resolvedAt = null,
    resolvedBy = null,
    nextReminderAt = null,
    requester = USER,
  } = opts;
  d1(`INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, approved_revision_id, approved_content_hash, approved_hash_version, requested_by_user_id, requested_at, resolved_by_user_id, resolved_at, next_reminder_at)
      VALUES (${q(id)}, ${q(chainId)}, ${q(status)}, ${q(priority)}, ${workflowVersion}, ${q(revId)}, ${q(contentHash)}, 1, ${approvedRevId ? q(approvedRevId) : "NULL"}, ${approvedHash ? q(approvedHash) : "NULL"}, ${approvedHashVersion ?? "NULL"}, ${q(requester)}, ${q(NOW)}, ${resolvedBy ? q(resolvedBy) : "NULL"}, ${resolvedAt ? q(resolvedAt) : "NULL"}, ${nextReminderAt ? q(nextReminderAt) : "NULL"});`);
}

function insertEvent(id, approvalId, chainId, eventType, workflowVersion, opts = {}) {
  const {
    actor = ADMIN,
    revId = null,
    contentHash = null,
    hashVersion = null,
    note = null,
  } = opts;
  d1(`INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, actor_user_id, revision_id, content_hash, hash_version, note, created_at)
      VALUES (${q(id)}, ${q(approvalId)}, ${q(chainId)}, ${q(eventType)}, ${workflowVersion}, ${actor ? q(actor) : "NULL"}, ${revId ? q(revId) : "NULL"}, ${contentHash ? q(contentHash) : "NULL"}, ${hashVersion ?? "NULL"}, ${note ? q(note) : "NULL"}, ${q(NOW)});`);
}

function setupCore() {
  insertUser(USER);
  insertUser(ADMIN, `${ADMIN}@example.test`);
  insertMailbox(MAILBOX);
  insertSender(SENDER, MAILBOX);
  insertSnapshot(SNAP, SENDER);
}

function cleanup() {
  const stmts = [
    `DELETE FROM mail_outbound_approval_events WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_approvals WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_revisions WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_snapshots WHERE id LIKE '${P}%';`,
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

function makeChain(suffix) {
  return `${P}-chain-${suffix}`;
}

function seedRevisionChain(baseId, hashes = [HASH_1]) {
  const chainId = makeChain(baseId);
  let parentId = null;
  const revIds = [];
  hashes.forEach((hash, index) => {
    const revId = `${baseId}-rev${index + 1}`;
    revIds.push(revId);
    if (index === 0) {
      insertRevision(revId, chainId, 1, hash);
    } else {
      insertRevision(revId, chainId, index + 1, hash, {
        parentRevisionId: parentId,
        revisionKind: "staff_resubmit",
      });
    }
    parentId = revId;
  });
  return { chainId, revIds };
}

function insertStandaloneApproval(approvalId, opts = {}) {
  const hashes = opts.hashes ?? [opts.contentHash ?? HASH_1];
  const { chainId, revIds } = seedRevisionChain(approvalId, hashes);
  const revId = revIds[revIds.length - 1];
  const contentHash = hashes[hashes.length - 1];
  insertApproval(approvalId, chainId, revId, contentHash, opts);
  return { chainId, revId, contentHash };
}

function countEvents(approvalId, workflowVersion, eventType = null) {
  let sql = `SELECT COUNT(*) AS c FROM mail_outbound_approval_events WHERE approval_id=${q(approvalId)} AND workflow_version=${workflowVersion}`;
  if (eventType) sql += ` AND event_type=${q(eventType)}`;
  const out = d1(sql);
  const m = out.match(/"c"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

function approvalRow(id) {
  const out = d1(
    `SELECT status, workflow_version, current_revision_id, current_content_hash, approved_revision_id, approved_content_hash, resolved_at, next_reminder_at FROM mail_outbound_approvals WHERE id=${q(id)};`,
  );
  const status = out.match(/"status"\s*:\s*"([^"]+)"/)?.[1];
  const workflowVersion = Number(
    out.match(/"workflow_version"\s*:\s*(\d+)/)?.[1],
  );
  const currentRevisionId = out.match(/"current_revision_id"\s*:\s*"([^"]+)"/)?.[1];
  const currentContentHash = out.match(/"current_content_hash"\s*:\s*"([^"]+)"/)?.[1];
  const approvedRevisionId = out.match(/"approved_revision_id"\s*:\s*(null|"([^"]+)")/)?.[2] ?? null;
  const approvedContentHash = out.match(/"approved_content_hash"\s*:\s*(null|"([^"]+)")/)?.[2] ?? null;
  const resolvedAt = out.match(/"resolved_at"\s*:\s*(null|"([^"]+)")/)?.[2] ?? null;
  const nextReminderAt = out.match(/"next_reminder_at"\s*:\s*(null|"([^"]+)")/)?.[2] ?? null;
  return {
    status,
    workflowVersion,
    currentRevisionId,
    currentContentHash,
    approvedRevisionId,
    approvedContentHash,
    resolvedAt,
    nextReminderAt,
  };
}

async function dbFirst(env, sql, ...binds) {
  const stmt = env.DB.prepare(sql);
  return binds.length ? stmt.bind(...binds).first() : stmt.first();
}

async function dbAll(env, sql, ...binds) {
  const stmt = env.DB.prepare(sql);
  return binds.length ? stmt.bind(...binds).all() : stmt.all();
}

function envGuardedInsertValues({
  eventId,
  approvalId,
  chainId,
  eventType,
  newVersion,
  newStatus,
  newRevId,
  newHash,
  newHashVersion,
  eventRevId,
  eventHash,
  actor = ADMIN,
  note = null,
}) {
  return {
    sql: `INSERT INTO mail_outbound_approval_events (
      id, approval_id, revision_chain_id, event_type, workflow_version,
      actor_user_id, revision_id, content_hash, hash_version, note, created_at
    ) VALUES (
      ?1,
      (SELECT id FROM mail_outbound_approvals
       WHERE id = ?2 AND workflow_version = ?3 AND status = ?4
         AND current_revision_id = ?5 AND current_content_hash = ?6
         AND current_hash_version = ?7),
      ?8, ?9, ?10, ?11, ?12, ?13, 1, ?14, ?15
    )`,
    binds: [
      eventId,
      approvalId,
      newVersion,
      newStatus,
      newRevId,
      newHash,
      newHashVersion,
      chainId,
      eventType,
      newVersion,
      actor,
      eventRevId,
      eventHash,
      note,
      NOW,
    ],
  };
}

async function runBatchHarness(env) {
  const REV1 = `${P}-rev1`;
  const REV2 = `${P}-rev2`;
  const REV3 = `${P}-rev3`;
  const APPR = `${P}-batch-approval`;
  const CHAIN = `${P}-batch-chain`;

  await dbAll(
    env,
    `DELETE FROM mail_outbound_approval_events WHERE id LIKE '${P}-batch%';`,
  );
  await dbAll(
    env,
    `DELETE FROM mail_outbound_approvals WHERE id LIKE '${P}-batch%';`,
  );
  await dbAll(
    env,
    `DELETE FROM mail_outbound_revisions WHERE id LIKE '${P}-batch%';`,
  );
  await dbAll(
    env,
    `DELETE FROM mail_signature_snapshots WHERE id LIKE '${P}-batch%';`,
  );

  for (const [revId, snapId, hash] of [
    [REV1, `${REV1}-snap`, HASH_1],
    [REV2, `${REV2}-snap`, HASH_2],
    [REV3, `${REV3}-snap`, HASH_3],
  ]) {
    await dbAll(
      env,
      `INSERT INTO mail_signature_snapshots (id, sender_identity_id, body_text, snapshot_hash, created_at)
       VALUES (?1, ?2, 'snap', ?3, ?4)`,
      snapId,
      SENDER,
      `${snapId}-hash`,
      NOW,
    );
  }

  await dbAll(
    env,
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version)
     VALUES (?1, ?2, 1, 'staff_submit', ?3, ?4, ?5, ?6, 'from@test', 'Subject', 'body', 'normal', 'new', ?7, ?8, 1)`,
    REV1,
    CHAIN,
    USER,
    NOW,
    MAILBOX,
    SENDER,
    `${REV1}-snap`,
    HASH_1,
  );
  await dbAll(
    env,
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, parent_revision_id, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version)
     VALUES (?1, ?2, 2, ?3, 'staff_resubmit', ?4, ?5, ?6, ?7, 'from@test', 'Subject', 'body', 'normal', 'new', ?8, ?9, 1)`,
    REV2,
    CHAIN,
    REV1,
    USER,
    NOW,
    MAILBOX,
    SENDER,
    `${REV2}-snap`,
    HASH_2,
  );
  await dbAll(
    env,
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, parent_revision_id, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version)
     VALUES (?1, ?2, 3, ?3, 'staff_resubmit', ?4, ?5, ?6, ?7, 'from@test', 'Subject', 'body', 'normal', 'new', ?8, ?9, 1)`,
    REV3,
    CHAIN,
    REV2,
    USER,
    NOW,
    MAILBOX,
    SENDER,
    `${REV3}-snap`,
    HASH_3,
  );

  await dbAll(
    env,
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
     VALUES (?1, ?2, 'pending', 'normal', 1, ?3, ?4, 1, ?5, ?6)`,
    APPR,
    CHAIN,
    REV1,
    HASH_1,
    USER,
    NOW,
  );
  await dbAll(
    env,
    `INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, actor_user_id, revision_id, content_hash, hash_version, created_at)
     VALUES (?1, ?2, ?3, 'submitted', 1, ?4, ?5, ?6, 1, ?7)`,
    `${P}-batch-ev-submitted-v1`,
    APPR,
    CHAIN,
    USER,
    REV1,
    HASH_1,
    NOW,
  );

  // Case A — valid transition pending v1 → returned v2
  {
    const cas = env.DB.prepare(
      `UPDATE mail_outbound_approvals SET
         status = 'returned', workflow_version = 2,
         resolved_at = ?1, resolved_by_user_id = ?2
       WHERE id = ?3 AND workflow_version = 1 AND status = 'pending'
         AND current_revision_id = ?4 AND current_content_hash = ?5 AND current_hash_version = 1`,
    ).bind(RESOLVED, ADMIN, APPR, REV1, HASH_1);
    const ev = env.DB.prepare(
      envGuardedInsertValues({
        eventId: `${P}-batch-ev-returned-v2`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "returned",
        newVersion: 2,
        newStatus: "returned",
        newRevId: REV1,
        newHash: HASH_1,
        newHashVersion: 1,
        eventRevId: REV1,
        eventHash: HASH_1,
      }).sql,
    ).bind(
      ...envGuardedInsertValues({
        eventId: `${P}-batch-ev-returned-v2`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "returned",
        newVersion: 2,
        newStatus: "returned",
        newRevId: REV1,
        newHash: HASH_1,
        newHashVersion: 1,
        eventRevId: REV1,
        eventHash: HASH_1,
      }).binds,
    );
    const batchResult = await env.DB.batch([cas, ev]);
    batchObservations.push({
      case: "A",
      casChanges: batchResult[0]?.meta?.changes,
    });
    const row = await dbFirst(
      env,
      `SELECT status, workflow_version FROM mail_outbound_approvals WHERE id = ?1`,
      APPR,
    );
    assert.equal(row.status, "returned");
    assert.equal(row.workflow_version, 2);
    const evCount = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_approval_events WHERE approval_id = ?1 AND workflow_version = 2 AND event_type = 'returned'`,
      APPR,
    );
    assert.equal(evCount.c, 1);
    pass("Batch Case A: valid CAS transition pending v1 → returned v2");
  }

  // Case B — stale v1 CAS + guarded approved v2 while returned v2 exists
  {
    const cas = env.DB.prepare(
      `UPDATE mail_outbound_approvals SET
         status = 'approved', workflow_version = 2,
         approved_revision_id = ?1, approved_content_hash = ?2, approved_hash_version = 1,
         resolved_at = ?3, resolved_by_user_id = ?4
       WHERE id = ?5 AND workflow_version = 1 AND status = 'pending'
         AND current_revision_id = ?6 AND current_content_hash = ?7 AND current_hash_version = 1`,
    ).bind(REV1, HASH_1, RESOLVED, ADMIN, APPR, REV1, HASH_1);
    const ev = env.DB.prepare(
      envGuardedInsertValues({
        eventId: `${P}-batch-ev-approved-v2-stale`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "approved",
        newVersion: 2,
        newStatus: "approved",
        newRevId: REV1,
        newHash: HASH_1,
        newHashVersion: 1,
        eventRevId: REV1,
        eventHash: HASH_1,
      }).sql,
    ).bind(
      ...envGuardedInsertValues({
        eventId: `${P}-batch-ev-approved-v2-stale`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "approved",
        newVersion: 2,
        newStatus: "approved",
        newRevId: REV1,
        newHash: HASH_1,
        newHashVersion: 1,
        eventRevId: REV1,
        eventHash: HASH_1,
      }).binds,
    );
    let failed = false;
    try {
      await env.DB.batch([cas, ev]);
    } catch {
      failed = true;
    }
    assert.ok(failed, "Case B batch should fail");
    const row = await dbFirst(
      env,
      `SELECT status, workflow_version FROM mail_outbound_approvals WHERE id = ?1`,
      APPR,
    );
    assert.equal(row.status, "returned");
    assert.equal(row.workflow_version, 2);
    const returnedCount = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_approval_events WHERE approval_id = ?1 AND workflow_version = 2 AND event_type = 'returned'`,
      APPR,
    );
    assert.equal(returnedCount.c, 1);
    const approvedCount = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_approval_events WHERE approval_id = ?1 AND workflow_version = 2 AND event_type = 'approved'`,
      APPR,
    );
    assert.equal(approvedCount.c, 0);
    pass("Batch Case B: stale CAS v1 + guarded v2 fails; returned v2 preserved");
  }

  // Legitimate resubmitted pending v3
  {
    const cas = env.DB.prepare(
      `UPDATE mail_outbound_approvals SET
         status = 'pending', workflow_version = 3,
         current_revision_id = ?1, current_content_hash = ?2, current_hash_version = 1,
         approved_revision_id = NULL, approved_content_hash = NULL, approved_hash_version = NULL,
         resolved_at = NULL, resolved_by_user_id = NULL
       WHERE id = ?3 AND workflow_version = 2 AND status = 'returned'
         AND current_revision_id = ?4 AND current_content_hash = ?5 AND current_hash_version = 1`,
    ).bind(REV2, HASH_2, APPR, REV1, HASH_1);
    const ev = env.DB.prepare(
      envGuardedInsertValues({
        eventId: `${P}-batch-ev-resubmitted-v3`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "resubmitted",
        newVersion: 3,
        newStatus: "pending",
        newRevId: REV2,
        newHash: HASH_2,
        newHashVersion: 1,
        eventRevId: REV2,
        eventHash: HASH_2,
      }).sql,
    ).bind(
      ...envGuardedInsertValues({
        eventId: `${P}-batch-ev-resubmitted-v3`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "resubmitted",
        newVersion: 3,
        newStatus: "pending",
        newRevId: REV2,
        newHash: HASH_2,
        newHashVersion: 1,
        eventRevId: REV2,
        eventHash: HASH_2,
      }).binds,
    );
    await env.DB.batch([cas, ev]);
    const row = await dbFirst(
      env,
      `SELECT status, workflow_version, current_revision_id FROM mail_outbound_approvals WHERE id = ?1`,
      APPR,
    );
    assert.equal(row.status, "pending");
    assert.equal(row.workflow_version, 3);
    assert.equal(row.current_revision_id, REV2);
    pass("Batch setup: returned v2 → resubmitted pending v3");
  }

  // Case C — zero-row CAS, unoccupied v4, guarded INSERT NOT NULL failure
  {
    const casSql = `UPDATE mail_outbound_approvals SET
         status = 'returned', workflow_version = 4,
         resolved_at = ?1, resolved_by_user_id = ?2
       WHERE id = ?3 AND workflow_version = 3 AND status = 'returned'
         AND current_revision_id = ?4 AND current_content_hash = ?5 AND current_hash_version = 1`;
    const casBinds = [RESOLVED, ADMIN, APPR, REV2, HASH_2];
    const casProbe = await env.DB.batch([
      env.DB.prepare(casSql).bind(...casBinds),
    ]);
    const casChanges = casProbe[0]?.meta?.changes ?? 0;
    assert.equal(casChanges, 0, "CAS probe should affect 0 rows");
    const cas = env.DB.prepare(casSql).bind(...casBinds);
    const ev = env.DB.prepare(
      envGuardedInsertValues({
        eventId: `${P}-batch-ev-returned-v4-fake`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "returned",
        newVersion: 4,
        newStatus: "returned",
        newRevId: REV2,
        newHash: HASH_2,
        newHashVersion: 1,
        eventRevId: REV2,
        eventHash: HASH_2,
      }).sql,
    ).bind(
      ...envGuardedInsertValues({
        eventId: `${P}-batch-ev-returned-v4-fake`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "returned",
        newVersion: 4,
        newStatus: "returned",
        newRevId: REV2,
        newHash: HASH_2,
        newHashVersion: 1,
        eventRevId: REV2,
        eventHash: HASH_2,
      }).binds,
    );
    let failed = false;
    try {
      await env.DB.batch([cas, ev]);
    } catch {
      failed = true;
    }
    batchObservations.push({ case: "C", casChanges, failed });
    assert.ok(failed, "Case C batch should fail");
    assert.equal(casChanges ?? 0, 0, "CAS should affect 0 rows");
    const row = await dbFirst(
      env,
      `SELECT status, workflow_version FROM mail_outbound_approvals WHERE id = ?1`,
      APPR,
    );
    assert.equal(row.status, "pending");
    assert.equal(row.workflow_version, 3);
    const v4Count = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_approval_events WHERE approval_id = ?1 AND workflow_version = 4`,
      APPR,
    );
    assert.equal(v4Count.c, 0);
    pass("Batch Case C: zero-row CAS + guarded INSERT fails; pending v3 preserved");
  }

  // Case D — valid CAS rolled back by failing guarded INSERT (wrong post-state)
  {
    const cas = env.DB.prepare(
      `UPDATE mail_outbound_approvals SET
         status = 'returned', workflow_version = 4,
         resolved_at = ?1, resolved_by_user_id = ?2
       WHERE id = ?3 AND workflow_version = 3 AND status = 'pending'
         AND current_revision_id = ?4 AND current_content_hash = ?5 AND current_hash_version = 1`,
    ).bind(RESOLVED, ADMIN, APPR, REV2, HASH_2);
    const ev = env.DB.prepare(
      envGuardedInsertValues({
        eventId: `${P}-batch-ev-returned-v4-rollback`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "returned",
        newVersion: 4,
        newStatus: "approved",
        newRevId: REV2,
        newHash: HASH_2,
        newHashVersion: 1,
        eventRevId: REV2,
        eventHash: HASH_2,
      }).sql,
    ).bind(
      ...envGuardedInsertValues({
        eventId: `${P}-batch-ev-returned-v4-rollback`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "returned",
        newVersion: 4,
        newStatus: "approved",
        newRevId: REV2,
        newHash: HASH_2,
        newHashVersion: 1,
        eventRevId: REV2,
        eventHash: HASH_2,
      }).binds,
    );
    let failed = false;
    try {
      await env.DB.batch([cas, ev]);
    } catch {
      failed = true;
    }
    assert.ok(failed, "Case D batch should fail");
    const row = await dbFirst(
      env,
      `SELECT status, workflow_version FROM mail_outbound_approvals WHERE id = ?1`,
      APPR,
    );
    assert.equal(row.status, "pending");
    assert.equal(row.workflow_version, 3);
    const v4Count = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_approval_events WHERE approval_id = ?1 AND workflow_version = 4`,
      APPR,
    );
    assert.equal(v4Count.c, 0);
    pass("Batch Case D: failing guarded INSERT rolls back valid CAS");
  }

  // Case E — valid approve pending v3 → approved v4
  {
    const cas = env.DB.prepare(
      `UPDATE mail_outbound_approvals SET
         status = 'approved', workflow_version = 4,
         approved_revision_id = ?1, approved_content_hash = ?2, approved_hash_version = 1,
         resolved_at = ?3, resolved_by_user_id = ?4
       WHERE id = ?5 AND workflow_version = 3 AND status = 'pending'
         AND current_revision_id = ?6 AND current_content_hash = ?7 AND current_hash_version = 1`,
    ).bind(REV2, HASH_2, RESOLVED, ADMIN, APPR, REV2, HASH_2);
    const ev = env.DB.prepare(
      envGuardedInsertValues({
        eventId: `${P}-batch-ev-approved-v4`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "approved",
        newVersion: 4,
        newStatus: "approved",
        newRevId: REV2,
        newHash: HASH_2,
        newHashVersion: 1,
        eventRevId: REV2,
        eventHash: HASH_2,
      }).sql,
    ).bind(
      ...envGuardedInsertValues({
        eventId: `${P}-batch-ev-approved-v4`,
        approvalId: APPR,
        chainId: CHAIN,
        eventType: "approved",
        newVersion: 4,
        newStatus: "approved",
        newRevId: REV2,
        newHash: HASH_2,
        newHashVersion: 1,
        eventRevId: REV2,
        eventHash: HASH_2,
      }).binds,
    );
    const batchResult = await env.DB.batch([cas, ev]);
    batchObservations.push({
      case: "E",
      casChanges: batchResult[0]?.meta?.changes,
    });
    const row = await dbFirst(
      env,
      `SELECT status, workflow_version, current_revision_id, current_content_hash, approved_revision_id, approved_content_hash FROM mail_outbound_approvals WHERE id = ?1`,
      APPR,
    );
    assert.equal(row.status, "approved");
    assert.equal(row.workflow_version, 4);
    assert.equal(row.current_revision_id, REV2);
    assert.equal(row.approved_revision_id, REV2);
    assert.equal(row.current_content_hash, HASH_2);
    assert.equal(row.approved_content_hash, HASH_2);
    const evCount = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_approval_events WHERE approval_id = ?1 AND workflow_version = 4 AND event_type = 'approved'`,
      APPR,
    );
    assert.equal(evCount.c, 1);
    pass("Batch Case E: valid pending v3 → approved v4");
  }

  // Initial create atomicity — valid + invalid batch
  {
    const createId = `${P}-batch-create`;
    const createChain = `${P}-batch-create-chain`;
    const createRev = `${P}-batch-create-rev`;
    const createSnap = `${createRev}-snap`;
    await dbAll(
      env,
      `INSERT INTO mail_signature_snapshots (id, sender_identity_id, body_text, snapshot_hash, created_at)
       VALUES (?1, ?2, 'snap', ?3, ?4)`,
      createSnap,
      SENDER,
      `${createSnap}-hash`,
      NOW,
    );
    await dbAll(
      env,
      `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version)
       VALUES (?1, ?2, 1, 'staff_submit', ?3, ?4, ?5, ?6, 'from@test', 'Subject', 'body', 'normal', 'new', ?7, ?8, 1)`,
      createRev,
      createChain,
      USER,
      NOW,
      MAILBOX,
      SENDER,
      createSnap,
      HASH_1,
    );
    const apprIns = env.DB.prepare(
      `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
       VALUES (?1, ?2, 'pending', 'normal', 1, ?3, ?4, 1, ?5, ?6)`,
    ).bind(createId, createChain, createRev, HASH_1, USER, NOW);
    const evIns = env.DB.prepare(
      `INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, actor_user_id, revision_id, content_hash, hash_version, created_at)
       VALUES (?1, ?2, ?3, 'submitted', 1, ?4, ?5, ?6, 1, ?7)`,
    ).bind(
      `${P}-batch-create-ev-ok`,
      createId,
      createChain,
      USER,
      createRev,
      HASH_1,
      NOW,
    );
    await env.DB.batch([apprIns, evIns]);
    const okRow = await dbFirst(
      env,
      `SELECT id FROM mail_outbound_approvals WHERE id = ?1`,
      createId,
    );
    assert.ok(okRow);
    pass("Batch initial create: Approval v1 + submitted Event v1 commits");

    const badId = `${P}-batch-create-fail`;
    const badChain = `${P}-batch-create-fail-chain`;
    const badRev = `${P}-batch-create-fail-rev`;
    const badSnap = `${badRev}-snap`;
    await dbAll(
      env,
      `INSERT INTO mail_signature_snapshots (id, sender_identity_id, body_text, snapshot_hash, created_at)
       VALUES (?1, ?2, 'snap', ?3, ?4)`,
      badSnap,
      SENDER,
      `${badSnap}-hash`,
      NOW,
    );
    await dbAll(
      env,
      `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version)
       VALUES (?1, ?2, 1, 'staff_submit', ?3, ?4, ?5, ?6, 'from@test', 'Subject', 'body', 'normal', 'new', ?7, ?8, 1)`,
      badRev,
      badChain,
      USER,
      NOW,
      MAILBOX,
      SENDER,
      badSnap,
      HASH_1,
    );
    const badAppr = env.DB.prepare(
      `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
       VALUES (?1, ?2, 'pending', 'normal', 1, ?3, ?4, 1, ?5, ?6)`,
    ).bind(badId, badChain, badRev, HASH_1, USER, NOW);
    const badEv = env.DB.prepare(
      `INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, actor_user_id, revision_id, content_hash, hash_version, created_at)
       VALUES (?1, ?2, ?3, 'submitted', 1, ?4, ?5, ?6, 1, ?7)`,
    ).bind(
      `${P}-batch-create-ev-bad`,
      badId,
      badChain,
      USER,
      badRev,
      "NOT-A-VALID-SHA256-HASH",
      NOW,
    );
    let createFailed = false;
    try {
      await env.DB.batch([badAppr, badEv]);
    } catch {
      createFailed = true;
    }
    assert.ok(createFailed);
    const badRow = await dbFirst(
      env,
      `SELECT id FROM mail_outbound_approvals WHERE id = ?1`,
      badId,
    );
    assert.equal(badRow, null);
    pass("Batch initial create: invalid Event rolls back Approval insert");
  }

  await dbAll(
    env,
    `DELETE FROM mail_outbound_approval_events WHERE id LIKE '${P}-batch%';`,
  );
  await dbAll(
    env,
    `DELETE FROM mail_outbound_approvals WHERE id LIKE '${P}-batch%';`,
  );
  await dbAll(
    env,
    `DELETE FROM mail_outbound_revisions WHERE id LIKE '${P}-batch%';`,
  );
}

console.log("=== Phase 2B.11 Local D1 Staff Approval Verification ===\n");

// Structure / migration baseline
run("Baseline: migration 0056 applied locally", () => {
  const out = d1(`SELECT id, name FROM d1_migrations WHERE id = 56;`);
  assert.match(out, /0056_mail_outbound_approval/);
  assert.doesNotMatch(
    d1(`SELECT name FROM d1_migrations WHERE id > 56;`),
    /0057/,
  );
});

run("Structure: approval tables exist", () => {
  const out = d1(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mail_outbound_approvals','mail_outbound_approval_events') ORDER BY name;`,
  );
  assert.match(out, /mail_outbound_approvals/);
  assert.match(out, /mail_outbound_approval_events/);
});

run("Structure: no send/transport/delivery tables from 0056", () => {
  const out = d1(
    `SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%send%' OR name LIKE '%transport%' OR name LIKE '%delivery%') AND name LIKE 'mail_%';`,
  );
  assert.doesNotMatch(out, /mail_outbound_send/);
  assert.doesNotMatch(out, /mail_transport/);
});

run("Structure: authored indexes present", () => {
  const out = d1(
    `SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'uq_mail_outbound_revisions_id_%' OR name LIKE 'uq_mail_outbound_approvals%' OR name LIKE 'idx_mail_outbound_approvals%' OR name LIKE 'idx_mail_outbound_approval_events%' OR name = 'uq_mail_outbound_approval_events_transition_per_version') ORDER BY name;`,
  );
  for (const idx of [
    "uq_mail_outbound_revisions_id_content_hash_version",
    "uq_mail_outbound_revisions_id_chain_hash_version",
    "uq_mail_outbound_approvals_revision_chain_id",
    "uq_mail_outbound_approvals_id_revision_chain_id",
    "idx_mail_outbound_approvals_status_requested_at",
    "idx_mail_outbound_approvals_current_revision_id",
    "idx_mail_outbound_approvals_approved_revision_id",
    "idx_mail_outbound_approvals_next_reminder_at",
    "idx_mail_outbound_approval_events_approval_created",
    "idx_mail_outbound_approval_events_actor_user_id",
    "idx_mail_outbound_approval_events_revision_id",
    "uq_mail_outbound_approval_events_transition_per_version",
  ]) {
    assert.match(out, new RegExp(idx), `missing ${idx}`);
  }
});

run("Structure: workflow_version on approvals and events", () => {
  const appr = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_outbound_approvals';`,
  );
  const ev = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_outbound_approval_events';`,
  );
  assert.match(appr, /workflow_version INTEGER NOT NULL DEFAULT 1/);
  assert.match(ev, /workflow_version INTEGER NOT NULL/);
});

cleanup();
setupCore();

// Section 7 — basic approval
run("A: valid pending Approval workflow_version=1", () => {
  const id = `${P}-appr-valid-v1`;
  insertStandaloneApproval(id);
  const row = approvalRow(id);
  assert.equal(row.status, "pending");
  assert.equal(row.workflowVersion, 1);
});

run("B: workflow_version=0 rejected", () => {
  const base = `${P}-appr-v0`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_1]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
     VALUES (${q(base)}, ${q(chainId)}, 'pending', 'normal', 0, ${q(revIds[0])}, ${q(HASH_1)}, 1, ${q(USER)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

run("C: invalid approval status rejected", () => {
  const base = `${P}-appr-bad-status`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_1]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
     VALUES (${q(base)}, ${q(chainId)}, 'sending', 'normal', 1, ${q(revIds[0])}, ${q(HASH_1)}, 1, ${q(USER)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

run("D: invalid priority rejected", () => {
  const base = `${P}-appr-bad-priority`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_1]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
     VALUES (${q(base)}, ${q(chainId)}, 'pending', 'critical', 1, ${q(revIds[0])}, ${q(HASH_1)}, 1, ${q(USER)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

run("E: priority normal/urgent pass", () => {
  insertStandaloneApproval(`${P}-appr-normal`, { priority: "normal" });
  insertStandaloneApproval(`${P}-appr-urgent`, { priority: "urgent", hashes: [HASH_3] });
});

// Section 8 — current revision provenance
run("Provenance: valid current revision + chain + hash passes", () => {
  insertStandaloneApproval(`${P}-prov-valid`, { hashes: [HASH_1, HASH_2] });
});

run("Provenance: wrong current_content_hash rejected", () => {
  const base = `${P}-prov-bad-hash`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_1, HASH_2]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
     VALUES (${q(base)}, ${q(chainId)}, 'pending', 'normal', 1, ${q(revIds[1])}, ${q(HASH_1)}, 1, ${q(USER)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

run("Provenance: wrong hash_version rejected", () => {
  const base = `${P}-prov-bad-hv`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_1, HASH_2]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
     VALUES (${q(base)}, ${q(chainId)}, 'pending', 'normal', 1, ${q(revIds[1])}, ${q(HASH_2)}, 99, ${q(USER)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

run("Provenance: revision from different chain rejected", () => {
  const base = `${P}-prov-wrong-chain`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_1]);
  const other = seedRevisionChain(`${base}-other`, [HASH_3]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at)
     VALUES (${q(base)}, ${q(chainId)}, 'pending', 'normal', 1, ${q(other.revIds[0])}, ${q(HASH_3)}, 1, ${q(USER)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

// Section 9 — approved == current
run("Approved: current #2 approved #2 same hash passes", () => {
  const id = `${P}-appr-ok-approved`;
  const { chainId, revIds } = seedRevisionChain(id, [HASH_1, HASH_2]);
  insertApproval(id, chainId, revIds[1], HASH_2, {
    status: "approved",
    approvedRevId: revIds[1],
    approvedHash: HASH_2,
    approvedHashVersion: 1,
    resolvedAt: RESOLVED,
    resolvedBy: ADMIN,
  });
});

run("Approved: current #2 approved #1 rejected", () => {
  const base = `${P}-appr-mismatch-rev`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_1, HASH_2]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, approved_revision_id, approved_content_hash, approved_hash_version, requested_by_user_id, requested_at, resolved_by_user_id, resolved_at)
     VALUES (${q(base)}, ${q(chainId)}, 'approved', 'normal', 1, ${q(revIds[1])}, ${q(HASH_2)}, 1, ${q(revIds[0])}, ${q(HASH_1)}, 1, ${q(USER)}, ${q(NOW)}, ${q(ADMIN)}, ${q(RESOLVED)});`,
    { expectFailure: true },
  );
  reject(err);
});

run("Approved: same id wrong hash rejected", () => {
  const base = `${P}-appr-mismatch-hash`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_1, HASH_2]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, approved_revision_id, approved_content_hash, approved_hash_version, requested_by_user_id, requested_at, resolved_by_user_id, resolved_at)
     VALUES (${q(base)}, ${q(chainId)}, 'approved', 'normal', 1, ${q(revIds[1])}, ${q(HASH_2)}, 1, ${q(revIds[1])}, ${q(HASH_1)}, 1, ${q(USER)}, ${q(NOW)}, ${q(ADMIN)}, ${q(RESOLVED)});`,
    { expectFailure: true },
  );
  reject(err);
});

run("Approved: approved status with approved_* NULL rejected", () => {
  const base = `${P}-appr-null-approved`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_3]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at, resolved_by_user_id, resolved_at)
     VALUES (${q(base)}, ${q(chainId)}, 'approved', 'normal', 1, ${q(revIds[0])}, ${q(HASH_3)}, 1, ${q(USER)}, ${q(NOW)}, ${q(ADMIN)}, ${q(RESOLVED)});`,
    { expectFailure: true },
  );
  reject(err);
});

run("Approved: non-approved with approved_* populated rejected", () => {
  const base = `${P}-appr-pending-with-approved`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_3]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, approved_revision_id, approved_content_hash, approved_hash_version, requested_by_user_id, requested_at)
     VALUES (${q(base)}, ${q(chainId)}, 'pending', 'normal', 1, ${q(revIds[0])}, ${q(HASH_3)}, 1, ${q(revIds[0])}, ${q(HASH_3)}, 1, ${q(USER)}, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

// Section 10 — resolution coupling
run("Resolution: pending + resolved_at NULL passes", () => {
  insertStandaloneApproval(`${P}-res-pending-ok`, { hashes: [HASH_3] });
});

run("Resolution: pending + resolved_at populated rejected", () => {
  const base = `${P}-res-pending-bad`;
  const { chainId, revIds } = seedRevisionChain(base, [HASH_3]);
  const err = d1(
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at, resolved_at)
     VALUES (${q(base)}, ${q(chainId)}, 'pending', 'normal', 1, ${q(revIds[0])}, ${q(HASH_3)}, 1, ${q(USER)}, ${q(NOW)}, ${q(RESOLVED)});`,
    { expectFailure: true },
  );
  reject(err);
});

for (const status of ["returned", "withdrawn", "approved"]) {
  run(`Resolution: ${status} + resolved_at NULL rejected`, () => {
    const base = `${P}-res-${status}-null-bad`;
    const { chainId, revIds } = seedRevisionChain(base, [HASH_3]);
    const extra =
      status === "approved"
        ? `, approved_revision_id, approved_content_hash, approved_hash_version`
        : "";
    const extraVals =
      status === "approved"
        ? `, ${q(revIds[0])}, ${q(HASH_3)}, 1`
        : "";
    const err = d1(
      `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at${extra})
       VALUES (${q(base)}, ${q(chainId)}, ${q(status)}, 'normal', 1, ${q(revIds[0])}, ${q(HASH_3)}, 1, ${q(USER)}, ${q(NOW)}${extraVals});`,
      { expectFailure: true },
    );
    reject(err);
  });
  run(`Resolution: ${status} + resolved_at populated passes`, () => {
    insertStandaloneApproval(`${P}-res-${status}-ok`, {
      hashes: [HASH_3],
      status,
      resolvedAt: RESOLVED,
      resolvedBy: ADMIN,
      ...(status === "approved"
        ? {
            approvedRevId: `${P}-res-${status}-ok-rev1`,
            approvedHash: HASH_3,
            approvedHashVersion: 1,
          }
        : {}),
    });
  });
}

// Section 11 — reminder coupling
run("Reminder: pending + next_reminder_at NULL passes", () => {
  insertStandaloneApproval(`${P}-rem-pending-null`, { hashes: [HASH_3] });
});

run("Reminder: pending + next_reminder_at populated passes", () => {
  insertStandaloneApproval(`${P}-rem-pending-set`, {
    hashes: [HASH_3],
    nextReminderAt: "2026-08-20T09:00:00.000Z",
  });
});

for (const status of ["returned", "withdrawn", "approved"]) {
  run(`Reminder: ${status} + next_reminder_at populated rejected`, () => {
    const base = `${P}-rem-${status}-bad`;
    const { chainId, revIds } = seedRevisionChain(base, [HASH_3]);
    const err = d1(
      `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, requested_by_user_id, requested_at, resolved_at, next_reminder_at${status === "approved" ? ", approved_revision_id, approved_content_hash, approved_hash_version" : ""})
       VALUES (${q(base)}, ${q(chainId)}, ${q(status)}, 'normal', 1, ${q(revIds[0])}, ${q(HASH_3)}, 1, ${q(USER)}, ${q(NOW)}, ${q(RESOLVED)}, '2026-08-20T09:00:00.000Z'${status === "approved" ? `, ${q(revIds[0])}, ${q(HASH_3)}, 1` : ""});`,
      { expectFailure: true },
    );
    reject(err);
  });
}

// Section 12–16 — events
const evApproval = `${P}-ev-approval-a`;
const evFixtures = insertStandaloneApproval(evApproval, { hashes: [HASH_1] });
const APPR_A = evApproval;
const CHAIN_A = evFixtures.chainId;
const REV_A1 = evFixtures.revId;

run("Events: workflow_version >= 1 and no updated_at", () => {
  const block = d1(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_outbound_approval_events';`,
  );
  assert.match(block, /workflow_version INTEGER NOT NULL/);
  assert.doesNotMatch(block, /updated_at/i);
});

for (const [eventType, wfVersion] of [
  ["submitted", 10],
  ["resubmitted", 11],
  ["returned", 12],
  ["withdrawn", 13],
  ["approved", 14],
  ["admin_edit", 15],
  ["reminder_sent", 1],
]) {
  run(`Events: ${eventType} valid insert`, () => {
    const id = `${P}-ev-type-${eventType}`;
    if (eventType === "reminder_sent") {
      insertEvent(id, APPR_A, CHAIN_A, eventType, 1, {
        revId: null,
        contentHash: null,
        hashVersion: null,
      });
    } else {
      insertEvent(id, APPR_A, CHAIN_A, eventType, wfVersion, {
        revId: REV_A1,
        contentHash: HASH_1,
        hashVersion: 1,
      });
    }
  });
}

run("Events: invalid event type rejected", () => {
  const err = d1(
    `INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, created_at)
     VALUES ('${P}-ev-bad-type', ${q(APPR_A)}, ${q(CHAIN_A)}, 'sent', 1, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

for (const [eventType, wfVersion] of [
  ["submitted", 20],
  ["resubmitted", 21],
  ["returned", 22],
  ["withdrawn", 23],
  ["approved", 24],
  ["admin_edit", 25],
]) {
  run(`Events: ${eventType} missing revision tuple rejected`, () => {
    const err = d1(
      `INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, created_at)
       VALUES ('${P}-ev-missing-${eventType}', ${q(APPR_A)}, ${q(CHAIN_A)}, ${q(eventType)}, ${wfVersion}, ${q(NOW)});`,
      { expectFailure: true },
    );
    reject(err);
  });
  run(`Events: ${eventType} partial revision tuple rejected`, () => {
    const err = d1(
      `INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, revision_id, created_at)
       VALUES ('${P}-ev-partial-${eventType}', ${q(APPR_A)}, ${q(CHAIN_A)}, ${q(eventType)}, ${wfVersion + 10}, ${q(REV_A1)}, ${q(NOW)});`,
      { expectFailure: true },
    );
    reject(err);
  });
}

run("Events: reminder_sent NULL revision provenance passes", () => {
  insertEvent(`${P}-ev-rem-null`, APPR_A, CHAIN_A, "reminder_sent", 1, {
    revId: null,
    contentHash: null,
    hashVersion: null,
  });
});

run("Events: reminder_sent valid revision provenance passes", () => {
  insertEvent(`${P}-ev-rem-rev`, APPR_A, CHAIN_A, "reminder_sent", 1, {
    revId: REV_A1,
    contentHash: HASH_1,
    hashVersion: 1,
  });
});

// Section 14 — chain provenance
run("Chain: approval A + revision A + chain A passes", () => {
  insertEvent(`${P}-ev-chain-ok`, APPR_A, CHAIN_A, "submitted", 50, {
    revId: REV_A1,
    contentHash: HASH_1,
    hashVersion: 1,
  });
});

run("Chain: approval A + revision B + chain B rejected", () => {
  const other = seedRevisionChain(`${P}-ev-chain-other`, [HASH_3]);
  const err = d1(
    `INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, revision_id, content_hash, hash_version, created_at)
     VALUES ('${P}-ev-chain-bad', ${q(APPR_A)}, ${q(other.chainId)}, 'submitted', 51, ${q(other.revIds[0])}, ${q(HASH_3)}, 1, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

// Section 15 — transition uniqueness
run("Transition UNIQUE: duplicate non-reminder same version rejected", () => {
  const apprId = `${P}-uniq-appr`;
  const fixtures = insertStandaloneApproval(apprId, { hashes: [HASH_3] });
  insertEvent(`${P}-uniq-ev1`, apprId, fixtures.chainId, "returned", 2, {
    revId: fixtures.revId,
    contentHash: HASH_3,
    hashVersion: 1,
  });
  const err = d1(
    `INSERT INTO mail_outbound_approval_events (id, approval_id, revision_chain_id, event_type, workflow_version, revision_id, content_hash, hash_version, created_at)
     VALUES ('${P}-uniq-ev2', ${q(apprId)}, ${q(fixtures.chainId)}, 'approved', 2, ${q(fixtures.revId)}, ${q(HASH_3)}, 1, ${q(NOW)});`,
    { expectFailure: true },
  );
  reject(err);
});

// Section 16 — reminder exception
run("Reminder: multiple reminder_sent same version allowed", () => {
  const apprId = `${P}-rem-multi`;
  const fixtures = insertStandaloneApproval(apprId, { hashes: [HASH_3] });
  insertEvent(`${P}-rem-multi-1`, apprId, fixtures.chainId, "reminder_sent", 1);
  insertEvent(`${P}-rem-multi-2`, apprId, fixtures.chainId, "reminder_sent", 1);
  assert.equal(countEvents(apprId, 1, "reminder_sent"), 2);
  const row = approvalRow(apprId);
  assert.equal(row.workflowVersion, 1);
});

// Section 25 — attribution / delete
run("Attribution: resolved_by_user_id SET NULL on user delete", () => {
  const resolver = `${P}-resolver`;
  insertUser(resolver);
  const apprId = `${P}-attr-resolved`;
  insertStandaloneApproval(apprId, {
    hashes: [HASH_3],
    status: "returned",
    resolvedAt: RESOLVED,
    resolvedBy: resolver,
  });
  d1(`DELETE FROM users WHERE id = ${q(resolver)};`);
  const out = d1(
    `SELECT resolved_by_user_id FROM mail_outbound_approvals WHERE id = ${q(apprId)};`,
  );
  assert.match(out, /"resolved_by_user_id"\s*:\s*null/);
  assert.match(
    d1(`SELECT id FROM mail_outbound_approvals WHERE id = ${q(apprId)};`),
    new RegExp(apprId),
  );
});

run("Attribution: event actor_user_id SET NULL on user delete", () => {
  const actor = `${P}-actor-del`;
  insertUser(actor);
  const apprId = `${P}-attr-event`;
  const fixtures = insertStandaloneApproval(apprId, { hashes: [HASH_3] });
  const evId = `${P}-attr-ev`;
  insertEvent(evId, apprId, fixtures.chainId, "reminder_sent", 1, { actor });
  d1(`DELETE FROM users WHERE id = ${q(actor)};`);
  const out = d1(
    `SELECT actor_user_id FROM mail_outbound_approval_events WHERE id = ${q(evId)};`,
  );
  assert.match(out, /"actor_user_id"\s*:\s*null/);
});

run("Attribution: requested_by_user_id RESTRICT on delete", () => {
  const requester = `${P}-requester-restrict`;
  insertUser(requester);
  const apprId = `${P}-attr-requester`;
  insertStandaloneApproval(apprId, { hashes: [HASH_3], requester });
  const err = d1(`DELETE FROM users WHERE id = ${q(requester)};`, {
    expectFailure: true,
  });
  reject(err);
});

// Batch harness via actual env.DB.batch
console.log("\n--- D1Database.batch() harness ---\n");
try {
  const { getPlatformProxy } = await import("wrangler");
  const { env, dispose } = await getPlatformProxy({
    configPath: join(process.cwd(), "wrangler.jsonc"),
  });
  try {
    pass("Batch harness: env.DB.batch available via getPlatformProxy");
    await runBatchHarness(env);
  } finally {
    await dispose();
  }
} catch (error) {
  fail("Batch harness", error.message);
}

cleanup();

run("Cleanup: zero mail-phase2b11 fixtures remain", () => {
  for (const table of [
    "mail_outbound_approval_events",
    "mail_outbound_approvals",
    "mail_outbound_revisions",
    "mail_signature_snapshots",
    "mail_sender_identities",
    "mail_mailboxes",
    "users",
  ]) {
    const col = table === "users" ? "id" : "id";
    const out = d1(
      `SELECT COUNT(*) AS c FROM ${table} WHERE ${col} LIKE '${P}%';`,
    );
    const m = out.match(/"c"\s*:\s*(\d+)/);
    assert.equal(Number(m?.[1] ?? -1), 0, `${table} has leftover fixtures`);
  }
});

const failed = results.filter((r) => !r.ok);
console.log("\n=== Summary ===");
console.log(`Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
if (batchObservations.length) {
  console.log("\nPost-batch CAS meta.changes (diagnostic only):");
  for (const obs of batchObservations) {
    console.log(`  Case ${obs.case}: changes=${obs.casChanges ?? "n/a"} failed=${obs.failed ?? false}`);
  }
}
if (failed.length) {
  console.error("\nFailed checks:");
  for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log("\nPhase 2B.11 Local D1 verification PASSED.");
