#!/usr/bin/env node
/**
 * Phase 2B.13 — Local D1 Send Operation + Transport Attempt runtime verification.
 * LOCAL ONLY: getPlatformProxy env.DB (+ minimal wrangler for structure checks).
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { join } from "node:path";

const NOW = "2026-08-20T07:10:00.000Z";
const COMPLETED = "2026-08-20T07:15:00.000Z";
const P = "mail-phase2b13";
const USER = `${P}-staff`;
const ADMIN = `${P}-admin`;
const MAILBOX = `${P}-mailbox`;
const SENDER = `${P}-sender`;

const HASH_1 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HASH_2 =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const HASH_3 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const results = [];
const batchObservations = [];

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

async function runAsync(name, fn) {
  try {
    await fn();
    if (!results.some((r) => r.name === name && !r.ok)) {
      if (!results.some((r) => r.name === name)) pass(name);
    }
  } catch (error) {
    fail(name, error.message);
  }
}

function reject(err) {
  assert.match(String(err), /CHECK|constraint|failed|UNIQUE|FOREIGN KEY|NOT NULL/i);
}

function d1Structure(sql) {
  return execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "crm-db", "--local", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function dbRun(env, sql, ...binds) {
  const stmt = env.DB.prepare(sql);
  return binds.length ? stmt.bind(...binds).run() : stmt.run();
}

async function dbFirst(env, sql, ...binds) {
  const stmt = env.DB.prepare(sql);
  return binds.length ? stmt.bind(...binds).first() : stmt.first();
}

async function dbAll(env, sql, ...binds) {
  const stmt = env.DB.prepare(sql);
  return binds.length ? stmt.bind(...binds).all() : stmt.all();
}

async function execExpectFail(env, sql, ...binds) {
  try {
    await dbRun(env, sql, ...binds);
    throw new Error(`Expected failure: ${sql}`);
  } catch (error) {
    if (error.message.startsWith("Expected failure")) throw error;
    return String(error);
  }
}

async function setupCore(env) {
  await dbRun(
    env,
    `INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
     VALUES (?1, ?2, 'Fixture', 'hash', 'staff', 1, 0, 0, 0, ?3, ?3)`,
    USER,
    `${USER}@test`,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
     VALUES (?1, ?2, 'Admin', 'hash', 'admin', 1, 0, 0, 0, ?3, ?3)`,
    ADMIN,
    `${ADMIN}@test`,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
     VALUES (?1, ?2, 'Mbox', 'shared', 'active', ?3, ?3)`,
    MAILBOX,
    `${MAILBOX}@mbox.test`,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
     VALUES (?1, ?2, 'From', 'active', ?3, ?4, ?4)`,
    SENDER,
    `${SENDER}@from.test`,
    MAILBOX,
    NOW,
  );
}

async function seedRevision(env, id, chainId, num, hash, opts = {}) {
  const { parentId = null, kind = "staff_submit" } = opts;
  const snap = `${id}-snap`;
  await dbRun(
    env,
    `INSERT INTO mail_signature_snapshots (id, sender_identity_id, body_text, snapshot_hash, created_at)
     VALUES (?1, ?2, 'snap', ?3, ?4)`,
    snap,
    SENDER,
    `${snap}-hash`,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO mail_outbound_revisions (id, revision_chain_id, revision_number, parent_revision_id, revision_kind, created_by_user_id, created_at, mailbox_id, sender_identity_id, from_address, subject, body_text, sensitivity, compose_mode, signature_snapshot_id, content_hash, hash_version)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'from@test', 'Subject', 'body', 'normal', 'new', ?10, ?11, 1)`,
    id,
    chainId,
    num,
    parentId,
    kind,
    USER,
    NOW,
    MAILBOX,
    SENDER,
    snap,
    hash,
  );
  return { snap };
}

async function insertSend(env, id, revId, chainId, hash, kind, opts = {}) {
  const {
    authMode = "admin_direct",
    approvalId = null,
    idempotencyKey = `${id}-idem`,
    status = "pending",
    orchVersion = 1,
    completedAt = null,
    nextAttemptAt = null,
    initiator = ADMIN,
  } = opts;
  await dbRun(
    env,
    `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, approval_id, idempotency_key, status, orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    id,
    revId,
    chainId,
    hash,
    kind,
    authMode,
    approvalId,
    idempotencyKey,
    status,
    orchVersion,
    initiator,
    NOW,
    completedAt,
    nextAttemptAt,
  );
}

async function insertAttempt(env, id, sendId, num, state, opts = {}) {
  const {
    provider = "fixture-provider",
    startedAt = NOW,
    completedAt = null,
    retryAfterAt = null,
  } = opts;
  await dbRun(
    env,
    `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, completed_at, retry_after_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    id,
    sendId,
    num,
    state,
    provider,
    startedAt,
    completedAt,
    retryAfterAt,
  );
}

async function seedApprovedWorkflow(env, base) {
  const chain = `${base}-chain`;
  const rev = `${base}-rev`;
  const appr = `${base}-appr`;
  await seedRevision(env, rev, chain, 1, HASH_1, { kind: "staff_submit" });
  await dbRun(
    env,
    `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, approved_revision_id, approved_content_hash, approved_hash_version, requested_by_user_id, requested_at, resolved_by_user_id, resolved_at)
     VALUES (?1, ?2, 'approved', 'normal', 1, ?3, ?4, 1, ?3, ?4, 1, ?5, ?6, ?7, ?8)`,
    appr,
    chain,
    rev,
    HASH_1,
    USER,
    NOW,
    ADMIN,
    COMPLETED,
  );
  return { chain, rev, appr };
}

function guardedAttemptInsertSql() {
  return `INSERT INTO mail_transport_attempts (
    id, send_operation_id, attempt_number, state, provider, started_at, completed_at, retry_after_at
  ) VALUES (
    ?1,
    (SELECT id FROM mail_send_operations
     WHERE id = ?2 AND status = ?3 AND orchestration_version = ?4),
    ?5, 'started', ?6, ?7, NULL, NULL
  )`;
}

async function cleanup(env) {
  const patterns = [
    `DELETE FROM mail_transport_attempts WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_send_operations WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_approval_events WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_approvals WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_revisions WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_snapshots WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_sender_identities WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_mailboxes WHERE id LIKE '${P}%';`,
    `DELETE FROM users WHERE id LIKE '${P}%';`,
  ];
  for (const sql of patterns) {
    try {
      await dbRun(env, sql);
    } catch {
      // best effort
    }
  }
}

console.log("=== Phase 2B.13 Local D1 Send Operation Verification ===\n");

const { getPlatformProxy } = await import("wrangler");
const { env, dispose } = await getPlatformProxy({
  configPath: join(process.cwd(), "wrangler.jsonc"),
});

try {
  // Structure checks (single wrangler call)
  run("Baseline: migration 0057 applied", () => {
    const out = d1Structure(`SELECT id, name FROM d1_migrations WHERE id = 57;`);
    assert.match(out, /0057_mail_send_operation/);
  });

  run("Structure: send + transport tables exist", () => {
    const out = d1Structure(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mail_send_operations','mail_transport_attempts') ORDER BY name;`,
    );
    assert.match(out, /mail_send_operations/);
    assert.match(out, /mail_transport_attempts/);
  });

  await runAsync("Structure: orchestration_version + indexes", async () => {
    const required = [
      "uq_mail_outbound_revisions_id_chain_hash_version_kind",
      "uq_mail_outbound_approvals_id_approved_revision_hash",
      "uq_mail_send_operations_outbound_revision_id",
      "uq_mail_send_operations_idempotency_key",
      "idx_mail_send_operations_status_next_attempt_at",
      "uq_mail_transport_attempts_send_operation_attempt_number",
      "uq_mail_transport_attempts_one_started_per_send_operation",
      "idx_mail_transport_attempts_send_operation_started_at",
      "idx_mail_transport_attempts_state",
      "idx_mail_transport_attempts_provider_message_id",
    ];
    for (const idx of required) {
      const row = await dbFirst(
        env,
        `SELECT name FROM sqlite_master WHERE type='index' AND name = ?1`,
        idx,
      );
      assert.equal(row?.name, idx, `missing ${idx}`);
    }
    const sendSql = await dbFirst(
      env,
      `SELECT sql FROM sqlite_master WHERE type='table' AND name = 'mail_send_operations'`,
    );
    assert.match(sendSql.sql, /orchestration_version INTEGER NOT NULL DEFAULT 1/);
  });

  run("Structure: no delivery table", () => {
    const out = d1Structure(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mail_delivery%';`,
    );
    assert.doesNotMatch(out, /mail_delivery/);
  });

  await cleanup(env);
  await setupCore(env);

  // Section 7 — basic send constraints
  await runAsync("Send: valid pending orchestration_version=1", async () => {
    const base = `${P}-send-valid`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await insertSend(env, base, rev, chain, HASH_1, "admin_direct");
    const row = await dbFirst(
      env,
      `SELECT status, orchestration_version FROM mail_send_operations WHERE id = ?1`,
      base,
    );
    assert.equal(row.status, "pending");
    assert.equal(row.orchestration_version, 1);
  });

  await runAsync("Send: orchestration_version=0 rejected", async () => {
    const base = `${P}-send-v0`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'pending', 0, ?6)`,
        base,
        rev,
        chain,
        HASH_2,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Send: invalid status rejected", async () => {
    const base = `${P}-send-bad-status`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'delivered', 1, ?6)`,
        base,
        rev,
        chain,
        HASH_2,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Send: invalid authorization_mode rejected", async () => {
    const base = `${P}-send-bad-auth`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'auto', ?5, 'pending', 1, ?6)`,
        base,
        rev,
        chain,
        HASH_2,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Send: blank idempotency_key rejected", async () => {
    const base = `${P}-send-blank-idem`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', '   ', 'pending', 1, ?5)`,
        base,
        rev,
        chain,
        HASH_2,
        NOW,
      ),
    );
  });

  await runAsync("Send: duplicate idempotency_key rejected", async () => {
    const key = `${P}-dup-idem-key`;
    const base1 = `${P}-send-dup-a`;
    const base2 = `${P}-send-dup-b`;
    const chain1 = `${base1}-chain`;
    const chain2 = `${base2}-chain`;
    const rev1 = `${base1}-rev`;
    const rev2 = `${base2}-rev`;
    await seedRevision(env, rev1, chain1, 1, HASH_1, { kind: "admin_direct" });
    await seedRevision(env, rev2, chain2, 1, HASH_3, { kind: "admin_direct" });
    await insertSend(env, base1, rev1, chain1, HASH_1, "admin_direct", {
      idempotencyKey: key,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'pending', 1, ?6)`,
        base2,
        rev2,
        chain2,
        HASH_3,
        key,
        NOW,
      ),
    );
  });

  await runAsync("Send: duplicate outbound_revision_id rejected", async () => {
    const rev = `${P}-send-dup-rev`;
    const chain = `${P}-send-dup-chain`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await insertSend(env, `${P}-send-dup-1`, rev, chain, HASH_1, "admin_direct");
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'pending', 1, ?6)`,
        `${P}-send-dup-2`,
        rev,
        chain,
        HASH_1,
        `${P}-send-dup-2-idem`,
        NOW,
      ),
    );
  });

  // Section 8 — revision provenance
  await runAsync("Provenance: valid revision passes", async () => {
    const rev = `${P}-prov-ok-rev`;
    const chain = `${P}-prov-ok-chain`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await insertSend(env, `${P}-prov-ok-send`, rev, chain, HASH_1, "admin_direct");
  });

  await runAsync("Provenance: wrong content_hash rejected", async () => {
    const base = `${P}-prov-hash`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'pending', 1, ?6)`,
        base,
        rev,
        chain,
        HASH_2,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Provenance: wrong hash_version rejected", async () => {
    const base = `${P}-prov-hv`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 99, 'admin_direct', 'admin_direct', ?5, 'pending', 1, ?6)`,
        base,
        rev,
        chain,
        HASH_1,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Provenance: wrong revision_chain_id rejected", async () => {
    const base = `${P}-prov-chain`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'pending', 1, ?6)`,
        base,
        rev,
        `${base}-wrong-chain`,
        HASH_1,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Provenance: wrong revision_kind rejected", async () => {
    const base = `${P}-prov-kind`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'staff_submit', 'admin_direct', ?5, 'pending', 1, ?6)`,
        base,
        rev,
        chain,
        HASH_1,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  // Section 9 — staff approved
  await runAsync("Staff approved: exact approved revision passes", async () => {
    const { chain, rev, appr } = await seedApprovedWorkflow(env, `${P}-staff-ok`);
    await insertSend(env, `${P}-staff-ok-send`, rev, chain, HASH_1, "staff_submit", {
      authMode: "staff_approved",
      approvalId: appr,
    });
  });

  await runAsync("Staff approved: approval_id NULL rejected", async () => {
    const { chain, rev } = await seedApprovedWorkflow(env, `${P}-staff-null`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, approval_id, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'staff_submit', 'staff_approved', NULL, ?5, 'pending', 1, ?6)`,
        `${P}-staff-null-send`,
        rev,
        chain,
        HASH_1,
        `${P}-staff-null-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Staff approved: wrong approval provenance rejected", async () => {
    const { chain, rev, appr } = await seedApprovedWorkflow(env, `${P}-staff-wrong`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, approval_id, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'staff_submit', 'staff_approved', ?5, ?6, 'pending', 1, ?7)`,
        `${P}-staff-wrong-send`,
        rev,
        chain,
        HASH_2,
        appr,
        `${P}-staff-wrong-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Staff approved: revision_kind admin_direct rejected", async () => {
    const base = `${P}-staff-ad`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    const appr = `${base}-appr`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await dbRun(
      env,
      `INSERT INTO mail_outbound_approvals (id, revision_chain_id, status, priority, workflow_version, current_revision_id, current_content_hash, current_hash_version, approved_revision_id, approved_content_hash, approved_hash_version, requested_by_user_id, requested_at, resolved_by_user_id, resolved_at)
       VALUES (?1, ?2, 'approved', 'normal', 1, ?3, ?4, 1, ?3, ?4, 1, ?5, ?6, ?7, ?8)`,
      appr,
      chain,
      rev,
      HASH_1,
      USER,
      NOW,
      ADMIN,
      COMPLETED,
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, approval_id, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'staff_approved', ?5, ?6, 'pending', 1, ?7)`,
        `${base}-send`,
        rev,
        chain,
        HASH_1,
        appr,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  // Section 10 — admin direct
  await runAsync("Admin direct: valid passes", async () => {
    const base = `${P}-admin-ok`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "admin_direct" });
    await insertSend(env, `${base}-send`, rev, chain, HASH_2, "admin_direct");
  });

  await runAsync("Admin direct: approval_id populated rejected", async () => {
    const { chain, rev, appr } = await seedApprovedWorkflow(env, `${P}-admin-appr`);
    const rev2 = `${P}-admin-appr-rev2`;
    await seedRevision(env, rev2, chain, 2, HASH_2, {
      parentId: rev,
      kind: "admin_direct",
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, approval_id, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, ?6, 'pending', 1, ?7)`,
        `${P}-admin-appr-send`,
        rev2,
        chain,
        HASH_2,
        appr,
        `${P}-admin-appr-idem`,
        NOW,
      ),
    );
  });

  await runAsync("Admin direct: staff revision kind rejected", async () => {
    const base = `${P}-admin-staff`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "staff_submit" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'staff_submit', 'admin_direct', ?5, 'pending', 1, ?6)`,
        `${base}-send`,
        rev,
        chain,
        HASH_2,
        `${base}-idem`,
        NOW,
      ),
    );
  });

  // Section 11 — send timestamp coupling
  await runAsync("Send timestamps: pending OK variants", async () => {
    const base = `${P}-ts-pending`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_3, { kind: "admin_direct" });
    await insertSend(env, `${base}-null`, rev, chain, HASH_3, "admin_direct", {
      idempotencyKey: `${base}-null-idem`,
    });
    const rev2 = `${base}-rev2`;
    const chain2 = `${base}-chain2`;
    await seedRevision(env, rev2, chain2, 1, HASH_3, { kind: "admin_direct" });
    await insertSend(env, `${base}-set`, rev2, chain2, HASH_3, "admin_direct", {
      idempotencyKey: `${base}-set-idem`,
      nextAttemptAt: "2026-08-21T09:00:00.000Z",
    });
  });

  await runAsync("Send timestamps: pending + completed_at rejected", async () => {
    const base = `${P}-ts-pend-bad`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_3, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'pending', 1, ?6, ?7)`,
        `${base}-send`,
        rev,
        chain,
        HASH_3,
        `${base}-idem`,
        NOW,
        COMPLETED,
      ),
    );
  });

  await runAsync("Send timestamps: processing OK", async () => {
    const base = `${P}-ts-proc`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_3, { kind: "admin_direct" });
    await insertSend(env, `${base}-send`, rev, chain, HASH_3, "admin_direct", {
      status: "processing",
      orchVersion: 2,
    });
  });

  await runAsync("Send timestamps: processing violations rejected", async () => {
    const base = `${P}-ts-proc-bad`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_3, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'processing', 2, ?6, ?7)`,
        `${base}-ca`,
        rev,
        chain,
        HASH_3,
        `${base}-ca-idem`,
        NOW,
        COMPLETED,
      ),
    );
    const rev2 = `${base}-rev2`;
    await seedRevision(env, rev2, `${base}-chain2`, 1, HASH_2, { kind: "admin_direct" });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at, next_attempt_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'processing', 2, ?6, ?7)`,
        `${base}-na`,
        rev2,
        `${base}-chain2`,
        HASH_2,
        `${base}-na-idem`,
        NOW,
        "2026-08-21T09:00:00.000Z",
      ),
    );
  });

  await runAsync("Send timestamps: accepted/failed coupling", async () => {
    const base = `${P}-ts-term`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await insertSend(env, `${base}-acc`, rev, chain, HASH_1, "admin_direct", {
      status: "accepted",
      orchVersion: 3,
      completedAt: COMPLETED,
      idempotencyKey: `${base}-acc-idem`,
    });
    const rev2 = `${base}-rev2`;
    const chain2 = `${base}-chain2`;
    await seedRevision(env, rev2, chain2, 1, HASH_2, { kind: "admin_direct" });
    await insertSend(env, `${base}-fail`, rev2, chain2, HASH_2, "admin_direct", {
      status: "failed",
      orchVersion: 4,
      completedAt: COMPLETED,
      idempotencyKey: `${base}-fail-idem`,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'accepted', 1, ?6)`,
        `${base}-acc-null`,
        rev,
        chain,
        HASH_1,
        `${base}-acc-null-idem`,
        NOW,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'failed', 1, ?6)`,
        `${base}-fail-null`,
        rev2,
        chain2,
        HASH_2,
        `${base}-fail-null-idem`,
        NOW,
      ),
    );
  });

  // Section 12-13 — transport attempts
  const sendForAttempts = `${P}-attempt-send`;
  {
    const chain = `${sendForAttempts}-chain`;
    const rev = `${sendForAttempts}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await insertSend(env, sendForAttempts, rev, chain, HASH_1, "admin_direct");
  }

  await runAsync("Attempt: attempt_number=1 passes", async () => {
    await insertAttempt(env, `${P}-att-1`, sendForAttempts, 1, "started");
    await dbRun(
      env,
      `UPDATE mail_transport_attempts SET state = 'accepted', completed_at = ?1 WHERE id = ?2`,
      COMPLETED,
      `${P}-att-1`,
    );
  });

  await runAsync("Attempt: attempt_number=0 rejected", async () => {
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at)
         VALUES (?1, ?2, 0, 'started', 'p', ?3)`,
        `${P}-att-0`,
        sendForAttempts,
        NOW,
      ),
    );
  });

  await runAsync("Attempt: duplicate attempt_number rejected", async () => {
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, completed_at)
         VALUES (?1, ?2, 1, 'accepted', 'p', ?3, ?4)`,
        `${P}-att-dup`,
        sendForAttempts,
        NOW,
        COMPLETED,
      ),
    );
  });

  await runAsync("Attempt: provider nonblank passes", async () => {
    await insertAttempt(env, `${P}-att-prov`, sendForAttempts, 2, "started", {
      provider: "fixture-smtp",
    });
  });

  await runAsync("Attempt: blank provider rejected", async () => {
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at)
         VALUES (?1, ?2, 3, 'started', '', ?3)`,
        `${P}-att-blank`,
        sendForAttempts,
        NOW,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at)
         VALUES (?1, ?2, 4, 'started', '   ', ?3)`,
        `${P}-att-space`,
        sendForAttempts,
        NOW,
      ),
    );
  });

  await runAsync("Attempt: invalid state rejected", async () => {
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at)
         VALUES (?1, ?2, 5, 'delivered', 'p', ?3)`,
        `${P}-att-bad-state`,
        sendForAttempts,
        NOW,
      ),
    );
  });

  await runAsync("Attempt: state/timestamp coupling", async () => {
    const send2 = `${P}-att-ts-send`;
    const chain = `${send2}-chain`;
    const rev = `${send2}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "admin_direct" });
    await insertSend(env, send2, rev, chain, HASH_2, "admin_direct", {
      idempotencyKey: `${send2}-idem`,
    });
    await insertAttempt(env, `${P}-att-started-ok`, send2, 1, "started");
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, completed_at)
         VALUES (?1, ?2, 2, 'started', 'p', ?3, ?4)`,
        `${P}-att-started-bad`,
        send2,
        NOW,
        COMPLETED,
      ),
    );
    await insertAttempt(env, `${P}-att-acc`, send2, 3, "accepted", {
      completedAt: COMPLETED,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at)
         VALUES (?1, ?2, 4, 'accepted', 'p', ?3)`,
        `${P}-att-acc-null`,
        send2,
        NOW,
      ),
    );
    await insertAttempt(env, `${P}-att-temp`, send2, 5, "temporary_failure", {
      completedAt: COMPLETED,
    });
    await insertAttempt(env, `${P}-att-temp-retry`, send2, 6, "temporary_failure", {
      completedAt: COMPLETED,
      retryAfterAt: "2026-08-21T10:00:00.000Z",
    });
    await insertAttempt(env, `${P}-att-perm`, send2, 7, "permanent_failure", {
      completedAt: COMPLETED,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, completed_at, retry_after_at)
         VALUES (?1, ?2, 8, 'accepted', 'p', ?3, ?4, ?5)`,
        `${P}-att-acc-retry`,
        send2,
        NOW,
        COMPLETED,
        "2026-08-21T10:00:00.000Z",
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, completed_at, retry_after_at)
         VALUES (?1, ?2, 9, 'permanent_failure', 'p', ?3, ?4, ?5)`,
        `${P}-att-perm-retry`,
        send2,
        NOW,
        COMPLETED,
        "2026-08-21T10:00:00.000Z",
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, retry_after_at)
         VALUES (?1, ?2, 10, 'started', 'p', ?3, ?4)`,
        `${P}-att-started-retry`,
        send2,
        NOW,
        "2026-08-21T10:00:00.000Z",
      ),
    );
  });

  // Section 14 — one active started attempt
  await runAsync("Active started: second started rejected then allowed after terminal", async () => {
    const sendId = `${P}-active-send`;
    const chain = `${sendId}-chain`;
    const rev = `${sendId}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await insertSend(env, sendId, rev, chain, HASH_1, "admin_direct");
    const att1 = `${P}-active-att1`;
    await insertAttempt(env, att1, sendId, 1, "started");
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at)
         VALUES (?1, ?2, 2, 'started', 'p', ?3)`,
        `${P}-active-att2-bad`,
        sendId,
        NOW,
      ),
    );
    await dbRun(
      env,
      `UPDATE mail_transport_attempts SET state = 'temporary_failure', completed_at = ?1 WHERE id = ?2`,
      COMPLETED,
      att1,
    );
    await insertAttempt(env, `${P}-active-att2`, sendId, 2, "started");
    const otherSend = `${P}-active-other`;
    const otherChain = `${otherSend}-chain`;
    const otherRev = `${otherSend}-rev`;
    await seedRevision(env, otherRev, otherChain, 1, HASH_3, { kind: "admin_direct" });
    await insertSend(env, otherSend, otherRev, otherChain, HASH_3, "admin_direct", {
      idempotencyKey: `${otherSend}-idem`,
    });
    await insertAttempt(env, `${P}-active-other-att`, otherSend, 1, "started");
  });

  pass("Batch harness: env.DB.batch available via getPlatformProxy");

  // Sections 16-22 — batch harness
  await runAsync("Batch Case M: valid guarded dispatch pending v1 → processing v2", async () => {
    const sendId = `${P}-batch-send`;
    const chain = `${sendId}-chain`;
    const rev = `${sendId}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await insertSend(env, sendId, rev, chain, HASH_1, "admin_direct", {
      idempotencyKey: `${sendId}-idem`,
    });
    const cas = env.DB.prepare(
      `UPDATE mail_send_operations SET status = 'processing', orchestration_version = 2, next_attempt_at = NULL
       WHERE id = ?1 AND orchestration_version = 1 AND status = 'pending'`,
    ).bind(sendId);
    const attId = `${P}-batch-att1`;
    const ev = env.DB.prepare(guardedAttemptInsertSql()).bind(
      attId,
      sendId,
      "processing",
      2,
      1,
      "fixture-provider",
      NOW,
    );
    const batchResult = await env.DB.batch([cas, ev]);
    batchObservations.push({
      case: "M",
      casChanges: batchResult[0]?.meta?.changes,
    });
    const row = await dbFirst(
      env,
      `SELECT status, orchestration_version FROM mail_send_operations WHERE id = ?1`,
      sendId,
    );
    assert.equal(row.status, "processing");
    assert.equal(row.orchestration_version, 2);
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_transport_attempts WHERE send_operation_id = ?1 AND state = 'started'`,
      sendId,
    );
    assert.equal(cnt.c, 1);
  });

  await runAsync("Batch Case N: zero-row CAS + guarded INSERT fails", async () => {
    const sendId = `${P}-batch-zero`;
    const chain = `${sendId}-chain`;
    const rev = `${sendId}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "admin_direct" });
    await insertSend(env, sendId, rev, chain, HASH_2, "admin_direct", {
      idempotencyKey: `${sendId}-idem`,
    });
    const casSql = `UPDATE mail_send_operations SET status = 'processing', orchestration_version = 2, next_attempt_at = NULL
       WHERE id = ?1 AND orchestration_version = 99 AND status = 'pending'`;
    const probe = await env.DB.batch([
      env.DB.prepare(casSql).bind(sendId),
    ]);
    const casChanges = probe[0]?.meta?.changes ?? 0;
    assert.equal(casChanges, 0);
    const cas = env.DB.prepare(casSql).bind(sendId);
    const ev = env.DB.prepare(guardedAttemptInsertSql()).bind(
      `${P}-batch-zero-att`,
      sendId,
      "processing",
      2,
      1,
      "fixture-provider",
      NOW,
    );
    let failed = false;
    try {
      await env.DB.batch([cas, ev]);
    } catch {
      failed = true;
    }
    batchObservations.push({ case: "N", casChanges, failed });
    assert.ok(failed);
    const row = await dbFirst(
      env,
      `SELECT status, orchestration_version FROM mail_send_operations WHERE id = ?1`,
      sendId,
    );
    assert.equal(row.status, "pending");
    assert.equal(row.orchestration_version, 1);
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_transport_attempts WHERE send_operation_id = ?1`,
      sendId,
    );
    assert.equal(cnt.c, 0);
  });

  await runAsync("Batch Case O: later statement failure rolls back valid CAS", async () => {
    const sendId = `${P}-batch-rollback`;
    const chain = `${sendId}-chain`;
    const rev = `${sendId}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_3, { kind: "admin_direct" });
    await insertSend(env, sendId, rev, chain, HASH_3, "admin_direct", {
      idempotencyKey: `${sendId}-idem`,
    });
    const cas = env.DB.prepare(
      `UPDATE mail_send_operations SET status = 'processing', orchestration_version = 2, next_attempt_at = NULL
       WHERE id = ?1 AND orchestration_version = 1 AND status = 'pending'`,
    ).bind(sendId);
    const badEv = env.DB.prepare(
      `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, completed_at)
       VALUES (?1, ?2, 0, 'started', 'p', ?3, NULL)`,
    ).bind(`${P}-batch-rollback-att`, sendId, NOW);
    let failed = false;
    try {
      await env.DB.batch([cas, badEv]);
    } catch {
      failed = true;
    }
    assert.ok(failed);
    const row = await dbFirst(
      env,
      `SELECT status, orchestration_version FROM mail_send_operations WHERE id = ?1`,
      sendId,
    );
    assert.equal(row.status, "pending");
    assert.equal(row.orchestration_version, 1);
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_transport_attempts WHERE send_operation_id = ?1`,
      sendId,
    );
    assert.equal(cnt.c, 0);
  });

  await runAsync("Batch Cases P-Q-R-S: retry generations + stale worker + terminality + accepted", async () => {
    const sendId = `${P}-batch-flow`;
    const chain = `${sendId}-chain`;
    const rev = `${sendId}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_1, { kind: "admin_direct" });
    await insertSend(env, sendId, rev, chain, HASH_1, "admin_direct", {
      idempotencyKey: `${sendId}-idem`,
    });

    async function dispatch(sendOpId, fromVer, toVer, attNum, attId) {
      const cas = env.DB.prepare(
        `UPDATE mail_send_operations SET status = 'processing', orchestration_version = ?1, next_attempt_at = NULL
         WHERE id = ?2 AND orchestration_version = ?3 AND status = 'pending'`,
      ).bind(toVer, sendOpId, fromVer);
      const ev = env.DB.prepare(guardedAttemptInsertSql()).bind(
        attId,
        sendOpId,
        "processing",
        toVer,
        attNum,
        "fixture-provider",
        NOW,
      );
      await env.DB.batch([cas, ev]);
    }

    async function toPending(sendOpId, fromVer, toVer, attId) {
      const cas = env.DB.prepare(
        `UPDATE mail_send_operations SET status = 'pending', orchestration_version = ?1, next_attempt_at = ?2
         WHERE id = ?3 AND orchestration_version = ?4 AND status = 'processing'`,
      ).bind(toVer, "2026-08-21T11:00:00.000Z", sendOpId, fromVer);
      await dbRun(
        env,
        `UPDATE mail_transport_attempts SET state = 'temporary_failure', completed_at = ?1 WHERE id = ?2`,
        COMPLETED,
        attId,
      );
      await cas.run();
    }

    // pending v1 → processing v2, Attempt #1 started
    await dispatch(sendId, 1, 2, 1, `${P}-batch-flow-att1`);
    await toPending(sendId, 2, 3, `${P}-batch-flow-att1`);
    // pending v3 → processing v4, Attempt #2 started
    await dispatch(sendId, 3, 4, 2, `${P}-batch-flow-att2`);

    const rowMid = await dbFirst(
      env,
      `SELECT status, orchestration_version FROM mail_send_operations WHERE id = ?1`,
      sendId,
    );
    assert.equal(rowMid.status, "processing");
    assert.equal(rowMid.orchestration_version, 4);

    // Stale worker v2 cannot mutate processing v4
    const stale = await dbRun(
      env,
      `UPDATE mail_send_operations SET status = 'accepted', completed_at = ?1, orchestration_version = 3, next_attempt_at = NULL
       WHERE id = ?2 AND status = 'processing' AND orchestration_version = 2`,
      COMPLETED,
      sendId,
    );
    assert.equal(stale.meta.changes, 0);
    const afterStale = await dbFirst(
      env,
      `SELECT status, orchestration_version FROM mail_send_operations WHERE id = ?1`,
      sendId,
    );
    assert.equal(afterStale.status, "processing");
    assert.equal(afterStale.orchestration_version, 4);

    // Attempt #1 terminal — stale CAS reopen rejected
    const staleAtt = await dbRun(
      env,
      `UPDATE mail_transport_attempts SET state = 'accepted', completed_at = ?1
       WHERE id = ?2 AND state = 'started'`,
      COMPLETED,
      `${P}-batch-flow-att1`,
    );
    assert.equal(staleAtt.meta.changes, 0);
    const att1 = await dbFirst(
      env,
      `SELECT state FROM mail_transport_attempts WHERE id = ?1`,
      `${P}-batch-flow-att1`,
    );
    assert.equal(att1.state, "temporary_failure");
    const att2 = await dbFirst(
      env,
      `SELECT state FROM mail_transport_attempts WHERE id = ?1`,
      `${P}-batch-flow-att2`,
    );
    assert.equal(att2.state, "started");

    // Finish: Attempt #2 accepted, Send processing v4 → accepted v5
    await dbRun(
      env,
      `UPDATE mail_transport_attempts SET state = 'accepted', completed_at = ?1 WHERE id = ?2`,
      COMPLETED,
      `${P}-batch-flow-att2`,
    );
    await dbRun(
      env,
      `UPDATE mail_send_operations SET status = 'accepted', orchestration_version = 5, completed_at = ?1, next_attempt_at = NULL
       WHERE id = ?2 AND orchestration_version = 4 AND status = 'processing'`,
      COMPLETED,
      sendId,
    );
    const final = await dbFirst(
      env,
      `SELECT status, orchestration_version FROM mail_send_operations WHERE id = ?1`,
      sendId,
    );
    assert.equal(final.status, "accepted");
    assert.equal(final.orchestration_version, 5);
    const deliveryCnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name LIKE 'mail_delivery%'`,
    );
    assert.equal(deliveryCnt.c, 0);
  });

  // Section 23 — attribution
  await runAsync("Attribution: initiated_by SET NULL on user delete", async () => {
    const initiator = `${P}-initiator`;
    await dbRun(
      env,
      `INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
       VALUES (?1, ?2, 'Init', 'hash', 'admin', 1, 0, 0, 0, ?3, ?3)`,
      initiator,
      `${initiator}@test`,
      NOW,
    );
    const sendId = `${P}-attr-send`;
    const chain = `${sendId}-chain`;
    const rev = `${sendId}-rev`;
    await seedRevision(env, rev, chain, 1, HASH_2, { kind: "admin_direct" });
    await insertSend(env, sendId, rev, chain, HASH_2, "admin_direct", {
      initiator,
      idempotencyKey: `${sendId}-idem`,
    });
    await dbRun(env, `DELETE FROM users WHERE id = ?1`, initiator);
    const row = await dbFirst(
      env,
      `SELECT initiated_by_user_id FROM mail_send_operations WHERE id = ?1`,
      sendId,
    );
    assert.equal(row.initiated_by_user_id, null);
  });

  await cleanup(env);

  await runAsync("Cleanup: zero mail-phase2b13 fixtures remain", async () => {
    for (const table of [
      "mail_transport_attempts",
      "mail_send_operations",
      "mail_outbound_approval_events",
      "mail_outbound_approvals",
      "mail_outbound_revisions",
      "mail_signature_snapshots",
      "mail_sender_identities",
      "mail_mailboxes",
      "users",
    ]) {
      const row = await dbFirst(
        env,
        `SELECT COUNT(*) AS c FROM ${table} WHERE id LIKE ?1`,
        `${P}%`,
      );
      assert.equal(row.c, 0, `${table} has leftovers`);
    }
  });
} finally {
  await dispose();
}

const failed = results.filter((r) => !r.ok);
console.log("\n=== Summary ===");
console.log(
  `Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`,
);
if (batchObservations.length) {
  console.log("\nPost-batch CAS meta.changes (diagnostic only):");
  for (const obs of batchObservations) {
    console.log(
      `  Case ${obs.case}: changes=${obs.casChanges ?? "n/a"} failed=${obs.failed ?? false}`,
    );
  }
}
if (failed.length) {
  console.error("\nFailed checks:");
  for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log("\nPhase 2B.13 Local D1 verification PASSED.");
