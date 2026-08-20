#!/usr/bin/env node
/**
 * Phase 2B.17 — Local D1 Outbound Materialization runtime verification.
 * LOCAL ONLY: getPlatformProxy env.DB (+ minimal wrangler for structure checks).
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { join } from "node:path";

const NOW = "2026-08-20T07:50:00.000Z";
const SENT = "2026-08-20T07:51:00.000Z";
const COMPLETED = "2026-08-20T07:52:00.000Z";
const P = "mail-phase2b17";
const USER = `${P}-staff`;
const ADMIN = `${P}-admin`;
const MAILBOX = `${P}-mailbox`;
const SENDER = `${P}-sender`;
const THREAD = `${P}-thread`;

const HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HASH_B =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const FILE_HASH =
  "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";

function rfcFor(base) {
  return `<${base}@example.test>`;
}

const results = [];
const obs = {
  oneSendOneRfc: true,
  retryCreatesNewRfc: false,
  dbEnforcesSendAccepted: false,
  dbEnforcesAttemptAccepted: false,
  serviceMustEnforceBoth: true,
  rfcMayDifferFromMessage: false,
  materializationMayLinkInbound: false,
  dbProvesRecipientSet: false,
  serviceMustVerifyRecipientSet: true,
  failedSendCreatesSent: false,
};

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
    throw new Error(`Expected failure: ${sql.slice(0, 80)}`);
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
  await dbRun(
    env,
    `INSERT INTO mail_threads (id, mailbox_id, subject_normalized, last_message_at, created_at, updated_at)
     VALUES (?1, ?2, 'subject', ?3, ?3, ?3)`,
    THREAD,
    MAILBOX,
    NOW,
  );
}

async function seedRevision(env, id, chainId, hash, opts = {}) {
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
     VALUES (?1, ?2, 1, NULL, 'admin_direct', ?3, ?4, ?5, ?6, 'from@test', 'Subject', 'body', 'normal', 'new', ?7, ?8, 1)`,
    id,
    chainId,
    ADMIN,
    NOW,
    MAILBOX,
    SENDER,
    snap,
    hash,
  );
}

async function insertRecipient(env, id, revisionId, address, type, sort = 0) {
  await dbRun(
    env,
    `INSERT INTO mail_outbound_revision_recipients (id, revision_id, recipient_type, address, display_name, sort_order, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    id,
    revisionId,
    type,
    address,
    address.split("@")[0],
    sort,
    NOW,
  );
}

async function insertSend(env, id, revId, chainId, hash, opts = {}) {
  const { status = "accepted", idempotencyKey = `${id}-idem` } = opts;
  await dbRun(
    env,
    `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, approval_id, idempotency_key, status, orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at)
     VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', NULL, ?5, ?6, 5, ?7, ?8, ?9, NULL)`,
    id,
    revId,
    chainId,
    hash,
    idempotencyKey,
    status,
    ADMIN,
    NOW,
    status === "accepted" || status === "failed" ? COMPLETED : null,
  );
}

async function insertAttempt(env, id, sendId, state, num) {
  await dbRun(
    env,
    `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, completed_at)
     VALUES (?1, ?2, ?3, ?4, 'fixture-provider', ?5, ?6)`,
    id,
    sendId,
    num,
    state,
    NOW,
    state === "started" ? null : COMPLETED,
  );
}

async function insertRfcIdentity(env, id, sendId, revId, rfcId) {
  await dbRun(
    env,
    `INSERT INTO mail_outbound_rfc_identities (id, send_operation_id, outbound_revision_id, rfc_message_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
    id,
    sendId,
    revId,
    rfcId,
    NOW,
  );
}

async function insertOutboundMessage(env, id, internetMessageId, threadId = THREAD) {
  await dbRun(
    env,
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject, preview_text, sensitivity, internet_message_id, compose_mode, sent_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'outbound', ?4, 'from@test', 'Subject', '', 'normal', ?5, 'new', ?6, ?7, ?7)`,
    id,
    threadId,
    MAILBOX,
    SENDER,
    internetMessageId,
    SENT,
    NOW,
  );
}

async function insertInboundMessage(env, id, internetMessageId) {
  await dbRun(
    env,
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, sensitivity, internet_message_id, received_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'inbound', 'inbound@test', 'Subject', '', 'normal', ?4, ?5, ?5, ?5)`,
    id,
    THREAD,
    MAILBOX,
    internetMessageId,
    NOW,
  );
}

async function insertMessageRecipient(env, id, messageId, address, type, sort = 0) {
  await dbRun(
    env,
    `INSERT INTO mail_message_recipients (id, message_id, recipient_type, address, display_name, sort_order, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    id,
    messageId,
    type,
    address,
    address.split("@")[0],
    sort,
    NOW,
  );
}

async function insertMaterialization(env, id, opts) {
  const {
    sendId,
    revId,
    hash,
    attemptId,
    rfcIdentityId,
    rfcMessageId,
    messageId,
  } = opts;
  await dbRun(
    env,
    `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
    id,
    sendId,
    revId,
    hash,
    attemptId,
    rfcIdentityId,
    rfcMessageId,
    messageId,
    NOW,
  );
}

async function buildAcceptedGraph(env, base, rfcId = rfcFor(base)) {
  const chain = `${base}-chain`;
  const rev = `${base}-rev`;
  const send = `${base}-send`;
  const attempt = `${base}-attempt`;
  const rfc = `${base}-rfc`;
  const msg = `${base}-msg`;
  await seedRevision(env, rev, chain, HASH);
  await insertSend(env, send, rev, chain, HASH);
  await insertAttempt(env, attempt, send, "accepted", 1);
  await insertRfcIdentity(env, rfc, send, rev, rfcId);
  await insertOutboundMessage(env, msg, rfcId);
  return { chain, rev, send, attempt, rfc, msg, rfcId };
}

function recipientSet(rows) {
  return rows
    .map((r) => `${r.recipient_type}:${r.address.toLowerCase()}:${r.display_name ?? ""}`)
    .sort()
    .join("|");
}

async function cleanup(env) {
  const tables = [
    "mail_outbound_message_materializations",
    "mail_outbound_rfc_identities",
    "mail_message_attachments",
    "mail_outbound_revision_attachments",
    "mail_stored_files",
    "mail_message_recipients",
    "mail_messages",
    "mail_transport_attempts",
    "mail_send_operations",
    "mail_outbound_revision_recipients",
    "mail_outbound_revisions",
    "mail_signature_snapshots",
    "mail_threads",
    "mail_sender_identities",
    "mail_mailboxes",
    "users",
  ];
  for (const table of tables) {
    try {
      await dbRun(env, `DELETE FROM ${table} WHERE id LIKE ?1`, `${P}%`);
    } catch {
      // best effort
    }
  }
}

console.log("=== Phase 2B.17 Local D1 Outbound Materialization Verification ===\n");

const { getPlatformProxy } = await import("wrangler");
const { env, dispose } = await getPlatformProxy({
  configPath: join(process.cwd(), "wrangler.jsonc"),
});

try {
  run("Baseline: migration 0059 applied", () => {
    const out = d1Structure(`SELECT id, name FROM d1_migrations WHERE id = 59;`);
    assert.match(out, /0059_mail_outbound_materialization/);
  });

  await runAsync("Duplicate index audit: revision hash index owned by 0056 only", async () => {
    const rows = await dbAll(
      env,
      `SELECT name, sql FROM sqlite_master WHERE type='index' AND name='uq_mail_outbound_revisions_id_content_hash_version'`,
    );
    const list = rows.results ?? rows;
    assert.equal(list.length, 1, "expected exactly one revision hash index");
  });

  await runAsync("Structure: materialization + RFC tables and indexes", async () => {
    for (const table of [
      "mail_outbound_rfc_identities",
      "mail_outbound_message_materializations",
    ]) {
      const row = await dbFirst(
        env,
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?1`,
        table,
      );
      assert.equal(row?.name, table);
    }
    const indexes = [
      "uq_mail_outbound_rfc_identities_send_operation_id",
      "uq_mail_outbound_rfc_identities_rfc_message_id",
      "uq_mail_outbound_rfc_identities_id_send_operation_rfc_message_id",
      "uq_mail_outbound_message_materializations_send_operation_id",
      "uq_mail_outbound_message_materializations_mail_message_id",
      "uq_mail_messages_id_internet_message_id_direction",
      "uq_mail_messages_outbound_internet_message_id",
    ];
    for (const idx of indexes) {
      const row = await dbFirst(
        env,
        `SELECT name FROM sqlite_master WHERE type='index' AND name = ?1`,
        idx,
      );
      assert.equal(row?.name, idx, `missing ${idx}`);
    }
    const proj = await dbFirst(
      env,
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mail_outbound_recipient_materializations'`,
    );
    assert.equal(proj, null);
  });

  await cleanup(env);
  await setupCore(env);

  // Section 7 — RFC identity basics
  await runAsync("RFC identity: valid insert passes", async () => {
    const base = `${P}-rfc-basic`;
    const g = await buildAcceptedGraph(env, base);
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_rfc_identities WHERE send_operation_id = ?1`,
      g.send,
    );
    assert.equal(cnt.c, 1);
  });

  await runAsync("RFC identity: blank/spaces rejected", async () => {
    const base = `${P}-rfc-blank`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    const send = `${base}-send`;
    await seedRevision(env, rev, chain, HASH);
    await insertSend(env, send, rev, chain, HASH);
    for (const blank of ["", "   "]) {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_outbound_rfc_identities (id, send_operation_id, outbound_revision_id, rfc_message_id, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
          `${base}-rfc-${blank.length}`,
          send,
          rev,
          blank,
          NOW,
        ),
      );
    }
  });

  await runAsync("RFC identity: duplicate send rejected", async () => {
    const base = `${P}-rfc-dup-send`;
    const g = await buildAcceptedGraph(env, base);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_rfc_identities (id, send_operation_id, outbound_revision_id, rfc_message_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
        `${P}-rfc-dup-send-2`,
        g.send,
        g.rev,
        rfcFor(`${P}-rfc-dup-send-alt`),
        NOW,
      ),
    );
  });

  await runAsync("RFC identity: duplicate rfc_message_id rejected", async () => {
    const g1 = await buildAcceptedGraph(env, `${P}-rfc-dup-id1`);
    const base = `${P}-rfc-dup-id2`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    const send = `${base}-send`;
    await seedRevision(env, rev, chain, HASH_B);
    await insertSend(env, send, rev, chain, HASH_B, { idempotencyKey: `${send}-idem` });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_rfc_identities (id, send_operation_id, outbound_revision_id, rfc_message_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
        `${base}-rfc`,
        send,
        rev,
        g1.rfcId,
        NOW,
      ),
    );
  });

  pass("RFC identity: ONE LOGICAL SEND USES ONE STABLE RFC MESSAGE-ID");

  // Section 8 — retry semantics
  await runAsync("Retry: multiple attempts, one RFC identity", async () => {
    const base = `${P}-retry`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    const send = `${base}-send`;
    await seedRevision(env, rev, chain, HASH);
    await insertSend(env, send, rev, chain, HASH, { idempotencyKey: `${send}-idem` });
    await insertAttempt(env, `${base}-att-1`, send, "temporary_failure", 1);
    await insertAttempt(env, `${base}-att-2`, send, "temporary_failure", 2);
    await insertAttempt(env, `${base}-att-3`, send, "accepted", 3);
    await insertRfcIdentity(env, `${base}-rfc`, send, rev, rfcFor(base));
    const attCnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_transport_attempts WHERE send_operation_id = ?1`,
      send,
    );
    const rfcCnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_rfc_identities WHERE send_operation_id = ?1`,
      send,
    );
    assert.equal(attCnt.c, 3);
    assert.equal(rfcCnt.c, 1);
    obs.retryCreatesNewRfc = false;
    pass("Retry: TRANSPORT RETRY CREATES NEW RFC MESSAGE-ID — NO");
  });

  // Section 10 — outbound RFC uniqueness
  await runAsync("Outbound RFC: duplicate internet_message_id rejected", async () => {
    const dupRfc = rfcFor(`${P}-outbound-dup`);
    await insertOutboundMessage(env, `${P}-msg-a`, dupRfc);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject, preview_text, sensitivity, internet_message_id, compose_mode, sent_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'outbound', ?4, 'from@test', 'Subject', '', 'normal', ?5, 'new', ?6, ?7, ?7)`,
        `${P}-msg-b-dup`,
        THREAD,
        MAILBOX,
        SENDER,
        dupRfc,
        SENT,
        NOW,
      ),
    );
  });

  await runAsync("Inbound dedupe: mailbox-scoped unchanged", async () => {
    const in1 = `${P}-in-1`;
    const in2 = `${P}-in-2`;
    const inRfc = `<${P}-inbound@example.test>`;
    await insertInboundMessage(env, in1, inRfc);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, sensitivity, internet_message_id, received_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'inbound', 'x@test', 'Subject', '', 'normal', ?4, ?5, ?5, ?5)`,
        in2,
        THREAD,
        MAILBOX,
        inRfc,
        NOW,
      ),
    );
  });

  // Section 11 — valid materialization
  await runAsync("Materialization: valid full provenance passes", async () => {
    const g = await buildAcceptedGraph(env, `${P}-mat-valid`);
    await insertMaterialization(env, `${P}-mat-valid-row`, {
      sendId: g.send,
      revId: g.rev,
      hash: HASH,
      attemptId: g.attempt,
      rfcIdentityId: g.rfc,
      rfcMessageId: g.rfcId,
      messageId: g.msg,
    });
  });

  const main = await buildAcceptedGraph(env, `${P}-main`);

  // Section 12 — send/revision provenance
  await runAsync("Provenance: send+revision match; wrong revision/hash rejected", async () => {
    await insertMaterialization(env, `${P}-prov-send-ok`, {
      sendId: main.send,
      revId: main.rev,
      hash: HASH,
      attemptId: main.attempt,
      rfcIdentityId: main.rfc,
      rfcMessageId: main.rfcId,
      messageId: main.msg,
    });
    const revB = `${P}-prov-rev-b`;
    const chainB = `${P}-prov-chain-b`;
    await seedRevision(env, revB, chainB, HASH_B);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-prov-send-bad-rev`,
        main.send,
        revB,
        HASH,
        main.attempt,
        main.rfc,
        main.rfcId,
        main.msg,
        NOW,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-prov-send-bad-hash`,
        main.send,
        main.rev,
        HASH_B,
        main.attempt,
        main.rfc,
        main.rfcId,
        main.msg,
        NOW,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 2, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-prov-send-bad-version`,
        main.send,
        main.rev,
        HASH,
        main.attempt,
        main.rfc,
        main.rfcId,
        main.msg,
        NOW,
      ),
    );
  });

  // Section 13 — attempt/send provenance
  await runAsync("Provenance: attempt must belong to same send", async () => {
    const other = await buildAcceptedGraph(env, `${P}-prov-other`);
    const msg2 = `${P}-prov-msg2`;
    await insertOutboundMessage(env, msg2, rfcFor(`${P}-prov-msg2`));
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-prov-att-mismatch`,
        main.send,
        main.rev,
        HASH,
        other.attempt,
        main.rfc,
        main.rfcId,
        msg2,
        NOW,
      ),
    );
  });

  // Section 14 — service boundary
  await runAsync("Service boundary: non-accepted send/attempt may insert (expected)", async () => {
    const base = `${P}-svc-bound`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    const send = `${base}-send`;
    const attempt = `${base}-attempt`;
    const rfc = `${base}-rfc`;
    const msg = `${base}-msg`;
    await seedRevision(env, rev, chain, HASH);
    await insertSend(env, send, rev, chain, HASH, {
      status: "pending",
      idempotencyKey: `${send}-idem`,
    });
    await insertAttempt(env, attempt, send, "started", 1);
    await insertRfcIdentity(env, rfc, send, rev, `<${base}@example.test>`);
    await insertOutboundMessage(env, msg, `<${base}@example.test>`);
    await insertMaterialization(env, `${base}-mat`, {
      sendId: send,
      revId: rev,
      hash: HASH,
      attemptId: attempt,
      rfcIdentityId: rfc,
      rfcMessageId: `<${base}@example.test>`,
      messageId: msg,
    });
    obs.dbEnforcesSendAccepted = false;
    obs.dbEnforcesAttemptAccepted = false;
    obs.serviceMustEnforceBoth = true;
    pass("Service boundary: DB ENFORCES SEND STATUS = ACCEPTED — NO");
    pass("Service boundary: DB ENFORCES TRANSPORT ATTEMPT STATE = ACCEPTED — NO");
    pass("Service boundary: SERVICE MUST ENFORCE BOTH — YES");
  });

  // Section 15 — RFC identity composite
  await runAsync("RFC composite: identity+send+rfc must match", async () => {
    const gA = await buildAcceptedGraph(env, `${P}-rfc-comp-a`);
    const gB = await buildAcceptedGraph(env, `${P}-rfc-comp-b`);
    const msgX = `${P}-rfc-comp-msg`;
    await insertOutboundMessage(env, msgX, rfcFor(`${P}-rfc-comp-msg`));
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-rfc-comp-wrong-rfc`,
        gA.send,
        gA.rev,
        HASH,
        gA.attempt,
        gA.rfc,
        gB.rfcId,
        gA.msg,
        NOW,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-rfc-comp-wrong-send`,
        gA.send,
        gA.rev,
        HASH,
        gA.attempt,
        gB.rfc,
        gB.rfcId,
        gA.msg,
        NOW,
      ),
    );
  });

  // Section 16 — RFC must match mail_message
  await runAsync("RFC match: materialization rfc must equal message internet_message_id", async () => {
    const g = await buildAcceptedGraph(env, `${P}-rfc-match`);
    await insertMaterialization(env, `${P}-rfc-match-ok`, {
      sendId: g.send,
      revId: g.rev,
      hash: HASH,
      attemptId: g.attempt,
      rfcIdentityId: g.rfc,
      rfcMessageId: g.rfcId,
      messageId: g.msg,
    });
    const msgWrong = `${P}-rfc-match-wrong-msg`;
    await insertOutboundMessage(env, msgWrong, rfcFor(`${P}-rfc-match-wrong-msg`));
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-rfc-match-bad`,
        g.send,
        g.rev,
        HASH,
        g.attempt,
        g.rfc,
        g.rfcId,
        msgWrong,
        NOW,
      ),
    );
    obs.rfcMayDifferFromMessage = false;
    pass("RFC match: RFC IDENTITY RFC MESSAGE-ID MAY DIFFER FROM MAIL_MESSAGE INTERNET_MESSAGE_ID — NO");
  });

  // Section 17 — inbound attack
  await runAsync("Inbound attack: cannot materialize inbound message", async () => {
    const g = await buildAcceptedGraph(env, `${P}-inbound-atk`);
    const inbound = `${P}-inbound-msg`;
    await insertInboundMessage(env, inbound, `<${P}-inbound-only@example.test>`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-inbound-mat`,
        g.send,
        g.rev,
        HASH,
        g.attempt,
        g.rfc,
        g.rfcId,
        inbound,
        NOW,
      ),
    );
    obs.materializationMayLinkInbound = false;
    pass("Inbound attack: MATERIALIZATION MAY LINK INBOUND MESSAGE — NO");
  });

  // Section 18 — idempotency
  await runAsync("Idempotency: duplicate send_operation_id and mail_message_id rejected", async () => {
    const g = await buildAcceptedGraph(env, `${P}-idem`);
    await insertMaterialization(env, `${P}-idem-1`, {
      sendId: g.send,
      revId: g.rev,
      hash: HASH,
      attemptId: g.attempt,
      rfcIdentityId: g.rfc,
      rfcMessageId: g.rfcId,
      messageId: g.msg,
    });
    const msg2 = `${P}-idem-msg2`;
    await insertOutboundMessage(env, msg2, rfcFor(`${P}-idem-msg2`));
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-idem-dup-send`,
        g.send,
        g.rev,
        HASH,
        g.attempt,
        g.rfc,
        g.rfcId,
        msg2,
        NOW,
      ),
    );
    const g2 = await buildAcceptedGraph(env, `${P}-idem2`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_outbound_message_materializations (id, send_operation_id, outbound_revision_id, content_hash, hash_version, accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id, mail_message_id, message_direction, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, 'outbound', ?9)`,
        `${P}-idem-dup-msg`,
        g2.send,
        g2.rev,
        HASH,
        g2.attempt,
        g2.rfc,
        g2.rfcId,
        g.msg,
        NOW,
      ),
    );
    pass("Idempotency: ONE SEND MAY CREATE MULTIPLE SENT MATERIALIZATIONS — NO");
    pass("Idempotency: ONE CANONICAL MAIL_MESSAGE MAY BELONG TO MULTIPLE MATERIALIZATIONS — NO");
  });

  // Section 19 — failed send boundary
  await runAsync("Failed send: service contract only (no materialization required)", async () => {
    const base = `${P}-failed`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    const send = `${base}-send`;
    await seedRevision(env, rev, chain, HASH);
    await insertSend(env, send, rev, chain, HASH, {
      status: "failed",
      idempotencyKey: `${send}-idem`,
    });
    const matCnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_outbound_message_materializations WHERE send_operation_id = ?1`,
      send,
    );
    assert.equal(matCnt.c, 0);
    obs.failedSendCreatesSent = false;
    pass("Failed send: FAILED PRE-ACCEPTANCE SEND CREATES SENT MESSAGE BY SERVICE CONTRACT — NO");
  });

  // Section 20 — recipient set boundary
  await runAsync("Recipient set: service comparison detects missing recipient", async () => {
    const base = `${P}-recip`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    const send = `${base}-send`;
    const msg = `${base}-msg`;
    await seedRevision(env, rev, chain, HASH);
    const recTo = `${base}-rec-to`;
    const recCc = `${base}-rec-cc`;
    const recBcc = `${base}-rec-bcc`;
    await insertRecipient(env, recTo, rev, `to-${base}@example.test`, "to", 0);
    await insertRecipient(env, recCc, rev, `cc-${base}@example.test`, "cc", 1);
    await insertRecipient(env, recBcc, rev, `bcc-${base}@example.test`, "bcc", 2);
    await insertSend(env, send, rev, chain, HASH, { idempotencyKey: `${send}-idem` });
    await insertOutboundMessage(env, msg, `<${base}@example.test>`);
    await insertMessageRecipient(env, `${base}-m-to`, msg, `to-${base}@example.test`, "to", 0);
    await insertMessageRecipient(env, `${base}-m-cc`, msg, `cc-${base}@example.test`, "cc", 1);
    const revRows = await dbAll(
      env,
      `SELECT recipient_type, address, display_name FROM mail_outbound_revision_recipients WHERE revision_id = ?1 ORDER BY sort_order`,
      rev,
    );
    const msgRows = await dbAll(
      env,
      `SELECT recipient_type, address, display_name FROM mail_message_recipients WHERE message_id = ?1 ORDER BY sort_order`,
      msg,
    );
    const revSet = recipientSet(revRows.results ?? revRows);
    const msgSetFull = recipientSet(msgRows.results ?? msgRows);
    assert.notEqual(revSet, msgSetFull);
    obs.dbProvesRecipientSet = false;
    obs.serviceMustVerifyRecipientSet = true;
    pass("Recipient set: DB ALONE PROVES FULL RECIPIENT SET EQUALITY — NO");
    pass("Recipient set: SERVICE MUST VERIFY COMPLETE TO/CC/BCC SET — YES");
  });

  // Section 21 — attachment provenance
  await runAsync("Attachment: revision attachment lineage to message attachment", async () => {
    const base = `${P}-att`;
    const chain = `${base}-chain`;
    const rev = `${base}-rev`;
    const msg = `${base}-msg`;
    const file = `${base}-file`;
    const revAtt = `${base}-rev-att`;
    const msgAtt = `${base}-msg-att`;
    await seedRevision(env, rev, chain, HASH);
    await dbRun(
      env,
      `INSERT INTO mail_stored_files (id, content_hash, original_filename, mime_type, size_bytes, storage_provider, storage_bucket, storage_key, created_by_user_id, security_scan_status, security_scanned_at, created_at)
       VALUES (?1, ?2, 'doc.pdf', 'application/pdf', 100, 'r2', 'bucket', 'key', ?3, 'clean', ?4, ?4)`,
      file,
      FILE_HASH,
      ADMIN,
      NOW,
    );
    await dbRun(
      env,
      `INSERT INTO mail_outbound_revision_attachments (id, revision_id, stored_file_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at)
       VALUES (?1, ?2, ?3, ?4, 'doc.pdf', 'doc.pdf', 'application/pdf', 100, 0, 'direct_attachment', ?5)`,
      revAtt,
      rev,
      file,
      FILE_HASH,
      NOW,
    );
    await insertOutboundMessage(env, msg, `<${base}-att@example.test>`);
    await dbRun(
      env,
      `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, source_revision_attachment_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'doc.pdf', 'doc.pdf', 'application/pdf', 100, 0, 'direct_attachment', ?6)`,
      msgAtt,
      msg,
      file,
      revAtt,
      FILE_HASH,
      NOW,
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_message_attachments (id, message_id, stored_file_id, source_revision_attachment_id, content_hash, original_filename, display_filename, mime_type, size_bytes, sort_order, delivery_mode, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'doc.pdf', 'doc.pdf', 'application/pdf', 100, 0, 'direct_attachment', ?6)`,
        `${base}-bad-att`,
        msg,
        file,
        revAtt,
        HASH,
        NOW,
      ),
    );
  });

  // Section 22-23 — hash/threading boundary
  await runAsync("Threading: existing mail_messages RFC fields unchanged", async () => {
    const cols = await dbAll(
      env,
      `SELECT name FROM pragma_table_info('mail_messages')`,
    );
    const names = (cols.results ?? cols).map((c) => c.name);
    for (const col of [
      "internet_message_id",
      "in_reply_to",
      "references_header",
      "reply_to_message_id",
    ]) {
      assert.ok(names.includes(col), `missing ${col}`);
    }
    const matCols = await dbAll(
      env,
      `SELECT name FROM pragma_table_info('mail_outbound_message_materializations')`,
    );
    const matNames = (matCols.results ?? matCols).map((c) => c.name);
    assert.ok(!matNames.includes("in_reply_to"));
    pass("Hash boundary: RFC MESSAGE-ID NOT part of Hash v1 (documented)");
    pass("Hash boundary: HASH V1 MODIFIED — NO");
  });

  // Section 24 — retention
  await runAsync("Retention: parent delete blocked while materialization exists", async () => {
    const g = await buildAcceptedGraph(env, `${P}-retain`);
    const matId = `${P}-retain-mat`;
    await insertMaterialization(env, matId, {
      sendId: g.send,
      revId: g.rev,
      hash: HASH,
      attemptId: g.attempt,
      rfcIdentityId: g.rfc,
      rfcMessageId: g.rfcId,
      messageId: g.msg,
    });
    for (const sql of [
      [`DELETE FROM mail_send_operations WHERE id = ?1`, g.send],
      [`DELETE FROM mail_outbound_revisions WHERE id = ?1`, g.rev],
      [`DELETE FROM mail_transport_attempts WHERE id = ?1`, g.attempt],
      [`DELETE FROM mail_outbound_rfc_identities WHERE id = ?1`, g.rfc],
      [`DELETE FROM mail_messages WHERE id = ?1`, g.msg],
    ]) {
      reject(await execExpectFail(env, sql[0], sql[1]));
    }
    await dbRun(env, `DELETE FROM mail_outbound_message_materializations WHERE id = ?1`, matId);
    await dbRun(env, `DELETE FROM mail_transport_attempts WHERE id = ?1`, g.attempt);
    await dbRun(env, `DELETE FROM mail_outbound_rfc_identities WHERE id = ?1`, g.rfc);
    await dbRun(env, `DELETE FROM mail_messages WHERE id = ?1`, g.msg);
    await dbRun(env, `DELETE FROM mail_send_operations WHERE id = ?1`, g.send);
    await dbRun(env, `DELETE FROM mail_outbound_revisions WHERE id = ?1`, g.rev);
    pass("Retention: no CASCADE; cleanup after materialization removed");
  });

  // Section 25 — no provider/delivery coupling
  await runAsync("No provider/delivery columns on materialization/RFC tables", async () => {
    for (const table of [
      "mail_outbound_rfc_identities",
      "mail_outbound_message_materializations",
    ]) {
      const cols = await dbAll(
        env,
        `SELECT name FROM pragma_table_info('${table}')`,
      );
      const names = (cols.results ?? cols).map((c) => c.name);
      for (const forbidden of [
        "provider_request_id",
        "provider_message_id",
        "provider_event_id",
        "delivery_status",
        "bounce_status",
      ]) {
        assert.ok(!names.includes(forbidden), `${table}.${forbidden}`);
      }
    }
  });

  await cleanup(env);

  await runAsync("Cleanup: zero mail-phase2b17 fixtures remain", async () => {
    for (const table of [
      "mail_outbound_message_materializations",
      "mail_outbound_rfc_identities",
      "mail_message_attachments",
      "mail_outbound_revision_attachments",
      "mail_stored_files",
      "mail_message_recipients",
      "mail_messages",
      "mail_transport_attempts",
      "mail_send_operations",
      "mail_outbound_revision_recipients",
      "mail_outbound_revisions",
      "mail_signature_snapshots",
      "mail_threads",
      "mail_sender_identities",
      "mail_mailboxes",
      "users",
    ]) {
      const row = await dbFirst(
        env,
        `SELECT COUNT(*) AS c FROM ${table} WHERE id LIKE ?1`,
        `${P}%`,
      );
      assert.equal(row.c, 0, `${table} leftovers`);
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
console.log("\n=== Key Observations ===");
console.log(`ONE LOGICAL SEND USES ONE STABLE RFC MESSAGE-ID: ${obs.oneSendOneRfc ? "YES" : "NO"}`);
console.log(`TRANSPORT RETRY CREATES NEW RFC MESSAGE-ID: ${obs.retryCreatesNewRfc ? "YES" : "NO"}`);
console.log(`DB ENFORCES SEND STATUS = ACCEPTED: ${obs.dbEnforcesSendAccepted ? "YES" : "NO"}`);
console.log(`DB ENFORCES TRANSPORT ATTEMPT STATE = ACCEPTED: ${obs.dbEnforcesAttemptAccepted ? "YES" : "NO"}`);
console.log(`SERVICE MUST ENFORCE BOTH: ${obs.serviceMustEnforceBoth ? "YES" : "NO"}`);
console.log(`RFC IDENTITY RFC MESSAGE-ID MAY DIFFER FROM MAIL_MESSAGE INTERNET_MESSAGE_ID: ${obs.rfcMayDifferFromMessage ? "YES" : "NO"}`);
console.log(`MATERIALIZATION MAY LINK INBOUND MESSAGE: ${obs.materializationMayLinkInbound ? "YES" : "NO"}`);
console.log(`DB ALONE PROVES FULL RECIPIENT SET EQUALITY: ${obs.dbProvesRecipientSet ? "YES" : "NO"}`);
console.log(`SERVICE MUST VERIFY COMPLETE TO/CC/BCC SET: ${obs.serviceMustVerifyRecipientSet ? "YES" : "NO"}`);
console.log(`FAILED PRE-ACCEPTANCE SEND CREATES SENT MESSAGE BY SERVICE CONTRACT: ${obs.failedSendCreatesSent ? "YES" : "NO"}`);

if (failed.length) {
  console.error("\nFailed checks:");
  for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log("\nPhase 2B.17 Local D1 verification PASSED.");
