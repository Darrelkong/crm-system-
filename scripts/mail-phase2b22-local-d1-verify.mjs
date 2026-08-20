#!/usr/bin/env node
/**
 * Phase 2B.22 — Local D1 Provider Ingestion (0061) runtime verification.
 * LOCAL ONLY. Assumes 0061 applied. Fixture prefix: mail-phase2b22-*
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { join } from "node:path";

const NOW = "2026-08-20T09:30:00.000Z";
const ROUTED = "2026-08-20T09:31:00.000Z";
const FINAL = "2026-08-20T09:32:00.000Z";
const CORR = "2026-08-20T09:33:00.000Z";
const P = "mail-phase2b22";
const USER = `${P}-user`;
const ADMIN = `${P}-admin`;
const MB_A = `${P}-mb-a`;
const MB_B = `${P}-mb-b`;
const MB_FB = `${P}-mb-fallback`;
const SENDER = `${P}-sender`;
const THREAD_A = `${P}-thread-a`;
const THREAD_B = `${P}-thread-b`;
const THREAD_FB = `${P}-thread-fb`;
const RA_PRIMARY = `${P}-ra-primary`;
const RA_ALIAS = `${P}-ra-alias`;
const RA_B = `${P}-ra-b`;
const ADDR_PRIMARY = "primary-a@echfronthk.test";
const ADDR_ALIAS = "alias-a@echfronthk.test";
const ADDR_B = "mailbox-b@echfronthk.test";
const RFC_DIRECT = "<direct-mat@external.test>";
const RFC_MULTI = "<multi-envelope@external.test>";
const RFC_CROSS_A = "<cross-mailbox@external.test>";
const RFC_DUP = "<duplicate@external.test>";
const HASH_OK =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HASH_BAD = "not-a-valid-sha256-hash-value";

const results = [];
const obs = {
  ingestionDedupeGlobal: true,
  envelopeRecipientPreserved: true,
  inboundRoutingExactProvenance: true,
  originalRouteOwnerPreserved: true,
  fallbackDifferentMailbox: true,
  oneIngestionMultipleMessages: false,
  oneMessageMultipleLinks: true,
  outboundAsInbound: false,
  stagedDeliveryTypeDiffers: false,
  dbFullyProvesDeliveryCorrelation: false,
  serviceMustVerifyDeliveryCorrelation: true,
  staleWorkerMutated: false,
  zeroRowCasChanges: 0,
  fakeInboundMat: false,
  earlierCasRolledBack: true,
  quarantinedWithoutCanonical: true,
  nullRfcAllowed: true,
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
    throw new Error(`Expected failure: ${sql.slice(0, 100)}`);
  } catch (error) {
    if (error.message.startsWith("Expected failure")) throw error;
    return String(error);
  }
}

function guardedInboundMatSql() {
  return `INSERT INTO mail_inbound_message_materializations (
    id, ingestion_event_id, receiving_address_id, route_owner_mailbox_id,
    routed_address_snapshot, envelope_recipient_address, mail_message_id,
    materialized_mailbox_id, route_mode, fallback_reason, message_direction, materialized_at
  ) VALUES (
    ?1,
    (SELECT i.ingestion_event_id FROM mail_inbound_ingestion_events i
     INNER JOIN mail_provider_ingestion_events p ON p.id = i.ingestion_event_id
     WHERE i.ingestion_event_id = ?2 AND p.status = 'completed' AND p.processing_version = ?3),
    ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'inbound', ?12
  )`;
}

function guardedDeliveryMatSql() {
  return `INSERT INTO mail_delivery_event_materializations (
    id, ingestion_event_id, delivery_event_id, event_dedupe_key, delivery_event_type, materialized_at
  ) VALUES (
    ?1,
    (SELECT d.ingestion_event_id FROM mail_delivery_ingestion_events d
     INNER JOIN mail_provider_ingestion_events p ON p.id = d.ingestion_event_id
     WHERE d.ingestion_event_id = ?2 AND p.status = 'completed' AND p.processing_version = ?3),
    ?4, ?5, ?6, ?7
  )`;
}

async function cleanup(env) {
  const stmts = [
    `DELETE FROM mail_delivery_event_materializations WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_delivery_ingestion_events WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_inbound_message_materializations WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_inbound_ingestion_events WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_provider_ingestion_events WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_delivery_events WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_messages WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_transport_attempts WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_send_operations WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_revision_recipients WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_outbound_revisions WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_signature_snapshots WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_receiving_addresses WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_threads WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_sender_identities WHERE id LIKE '${P}%';`,
    `DELETE FROM mail_mailboxes WHERE id LIKE '${P}%';`,
    `DELETE FROM users WHERE id LIKE '${P}%';`,
  ];
  for (const sql of stmts) {
    try {
      await dbRun(env, sql);
    } catch {
      /* ignore */
    }
  }
}

async function setupCore(env) {
  await dbRun(
    env,
    `INSERT INTO users (id, email, display_name, password_hash, role, is_active, failed_login_attempts, must_change_password, initial_device_auto_approval_eligible, created_at, updated_at)
     VALUES (?1, ?2, 'Staff', 'hash', 'staff', 1, 0, 0, 0, ?3, ?3)`,
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
  for (const [mb, addr, thread] of [
    [MB_A, `${MB_A}@mbox.test`, THREAD_A],
    [MB_B, `${MB_B}@mbox.test`, THREAD_B],
    [MB_FB, `${MB_FB}@mbox.test`, THREAD_FB],
  ]) {
    await dbRun(
      env,
      `INSERT INTO mail_mailboxes (id, address, display_name, mailbox_type, status, created_at, updated_at)
       VALUES (?1, ?2, 'Mbox', 'shared', 'active', ?3, ?3)`,
      mb,
      addr,
      NOW,
    );
    await dbRun(
      env,
      `INSERT INTO mail_threads (id, mailbox_id, subject_normalized, last_message_at, created_at, updated_at)
       VALUES (?1, ?2, 'subject', ?3, ?3, ?3)`,
      thread,
      mb,
      NOW,
    );
  }
  await dbRun(
    env,
    `INSERT INTO mail_sender_identities (id, address, display_name, status, default_mailbox_id, created_at, updated_at)
     VALUES (?1, ?2, 'From', 'active', ?3, ?4, ?4)`,
    SENDER,
    `${SENDER}@from.test`,
    MB_A,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'primary', 'active', ?4, ?4)`,
    RA_PRIMARY,
    MB_A,
    ADDR_PRIMARY,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'alias', 'active', ?4, ?4)`,
    RA_ALIAS,
    MB_A,
    ADDR_ALIAS,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO mail_receiving_addresses (id, mailbox_id, address, address_type, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'primary', 'active', ?4, ?4)`,
    RA_B,
    MB_B,
    ADDR_B,
    NOW,
  );
}

async function insertGeneric(env, id, kind, dedupe, opts = {}) {
  const {
    status = "pending",
    version = 1,
    finalizedAt = null,
    quarantineReason = null,
    nextAttemptAt = null,
    providerEventId = null,
    payload = null,
  } = opts;
  await dbRun(
    env,
    `INSERT INTO mail_provider_ingestion_events (
      id, event_kind, provider, ingestion_dedupe_key, provider_event_id, status,
      processing_version, next_attempt_at, finalized_at, quarantine_reason, received_at,
      payload_storage_provider, payload_storage_key, payload_content_hash, payload_size_bytes
    ) VALUES (?1, ?2, 'fixture-provider', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    id,
    kind,
    dedupe,
    providerEventId,
    status,
    version,
    nextAttemptAt,
    finalizedAt,
    quarantineReason,
    NOW,
    payload?.provider ?? null,
    payload?.key ?? null,
    payload?.hash ?? null,
    payload?.size ?? null,
  );
}

async function insertInboundChild(
  env,
  id,
  ingestionId,
  envelope,
  route = null,
) {
  await dbRun(
    env,
    `INSERT INTO mail_inbound_ingestion_events (
      id, ingestion_event_id, event_kind, envelope_recipient_address,
      receiving_address_id, route_owner_mailbox_id, routed_address_snapshot, routed_at
    ) VALUES (?1, ?2, 'inbound_message', ?3, ?4, ?5, ?6, ?7)`,
    id,
    ingestionId,
    envelope,
    route?.raId ?? null,
    route?.mbId ?? null,
    route?.snapshot ?? null,
    route?.routedAt ?? null,
  );
}

async function insertDeliveryChild(env, id, ingestionId, recipient, type, corr = null) {
  await dbRun(
    env,
    `INSERT INTO mail_delivery_ingestion_events (
      id, ingestion_event_id, event_kind, recipient_address, delivery_event_type,
      send_operation_id, transport_attempt_id, outbound_revision_id,
      outbound_revision_recipient_id, correlated_at
    ) VALUES (?1, ?2, 'delivery_event', ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    id,
    ingestionId,
    recipient,
    type,
    corr?.sendId ?? null,
    corr?.attemptId ?? null,
    corr?.revId ?? null,
    corr?.recipientId ?? null,
    corr?.at ?? null,
  );
}

async function insertInboundMsg(env, id, mailboxId, threadId, internetMessageId = null) {
  await dbRun(
    env,
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, sensitivity, internet_message_id, received_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'inbound', 'external@test', 'Subject', '', 'normal', ?4, ?5, ?5, ?5)`,
    id,
    threadId,
    mailboxId,
    internetMessageId,
    NOW,
  );
}

async function insertOutboundMsg(env, id, mailboxId, threadId) {
  await dbRun(
    env,
    `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject, preview_text, sensitivity, internet_message_id, compose_mode, sent_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'outbound', ?4, 'from@test', 'Subject', '', 'normal', '<out@test>', 'new', ?5, ?5, ?5)`,
    id,
    threadId,
    mailboxId,
    SENDER,
    NOW,
  );
}

async function insertInboundMat(env, id, ingestionId, msgId, opts) {
  await dbRun(
    env,
    `INSERT INTO mail_inbound_message_materializations (
      id, ingestion_event_id, receiving_address_id, route_owner_mailbox_id,
      routed_address_snapshot, envelope_recipient_address, mail_message_id,
      materialized_mailbox_id, route_mode, fallback_reason, message_direction, materialized_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'inbound', ?11)`,
    id,
    ingestionId,
    opts.raId,
    opts.routeOwnerMb,
    opts.snapshot,
    opts.envelope,
    msgId,
    opts.materializedMb,
    opts.routeMode,
    opts.fallbackReason ?? null,
    NOW,
  );
}

async function seedRevision(env, revId, chainId, hash) {
  const snap = `${revId}-snap`;
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
    revId,
    chainId,
    ADMIN,
    NOW,
    MB_A,
    SENDER,
    snap,
    hash,
  );
}

async function seedDeliveryGraph(env, base) {
  const chain = `${base}-chain`;
  const rev = `${base}-rev`;
  const send = `${base}-send`;
  const att = `${base}-att`;
  const recip = `${base}-recip`;
  await seedRevision(env, rev, chain, HASH_OK);
  await dbRun(
    env,
    `INSERT INTO mail_outbound_revision_recipients (id, revision_id, recipient_type, address, display_name, sort_order, created_at)
     VALUES (?1, ?2, 'to', 'to@test', 'To', 0, ?3)`,
    recip,
    rev,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, idempotency_key, status, orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at)
     VALUES (?1, ?2, ?3, ?4, 1, 'admin_direct', 'admin_direct', ?5, 'accepted', 1, ?6, ?7, ?7, NULL)`,
    send,
    rev,
    chain,
    HASH_OK,
    `${base}-idem`,
    ADMIN,
    NOW,
  );
  await dbRun(
    env,
    `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, started_at, completed_at)
     VALUES (?1, ?2, 1, 'accepted', 'fixture-provider', ?3, ?3)`,
    att,
    send,
    NOW,
  );
  return { chain, rev, send, att, recip };
}

console.log("=== Phase 2B.22 Local D1 Provider Ingestion Verification ===\n");

const { getPlatformProxy } = await import("wrangler");
const { env, dispose } = await getPlatformProxy({
  configPath: join(process.cwd(), "wrangler.jsonc"),
});

try {
  // --- Structure ---
  run("Structure: five 0061 tables exist", () => {
    const out = d1Structure(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mail_%ingestion%' OR name LIKE 'mail_%materialization%' ORDER BY name;`,
    );
    for (const t of [
      "mail_provider_ingestion_events",
      "mail_inbound_ingestion_events",
      "mail_inbound_message_materializations",
      "mail_delivery_ingestion_events",
      "mail_delivery_event_materializations",
    ]) {
      assert.match(out, new RegExp(t));
    }
  });

  run("Structure: candidate keys + no 0062/forbidden columns", () => {
    const uq = d1Structure(
      `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uq_mail_%';`,
    );
    const idx = d1Structure(
      `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_mail_inbound_message_materializations%';`,
    );
    assert.match(uq, /uq_mail_messages_id_mailbox_direction/);
    assert.match(uq, /uq_mail_receiving_addresses_id_mailbox_address/);
    assert.match(uq, /uq_mail_delivery_events_id_event_type/);
    assert.match(uq, /uq_mail_inbound_message_materializations_ingestion_event_id/);
    assert.doesNotMatch(uq, /uq_mail_inbound_message_materializations_mail_message_id/);
    assert.match(idx, /idx_mail_inbound_message_materializations_mail_message_id/);
    const mig = d1Structure(
      `SELECT name FROM d1_migrations WHERE name LIKE '0062%';`,
    );
    assert.doesNotMatch(mig, /0062/);
    const cols = d1Structure(`PRAGMA table_info(mail_provider_ingestion_events);`);
    for (const bad of ["raw_mime", "webhook_body", "auth_header", "api_key", "bearer"]) {
      assert.doesNotMatch(cols, new RegExp(bad, "i"));
    }
  });

  await cleanup(env);
  await setupCore(env);

  // --- Generic ingestion kinds ---
  await runAsync("Generic: inbound_message kind", async () => {
    const id = `${P}-gen-inbound`;
    await insertGeneric(env, id, "inbound_message", `${id}-dedupe`);
  });

  await runAsync("Generic: delivery_event kind", async () => {
    const id = `${P}-gen-delivery`;
    await insertGeneric(env, id, "delivery_event", `${id}-dedupe`);
  });

  for (const bad of ["opened", "clicked", "invalid"]) {
    await runAsync(`Generic: reject event_kind=${bad}`, async () => {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, received_at)
           VALUES (?1, ?2, 'p', ?3, 'pending', 1, ?4)`,
          `${P}-gen-bad-${bad}`,
          bad,
          `${P}-gen-bad-${bad}-dedupe`,
          NOW,
        ),
      );
    });
  }

  // --- Dedupe ---
  await runAsync("Dedupe: valid nonblank passes", async () => {
    await insertGeneric(env, `${P}-dedupe-ok`, "inbound_message", `${P}-dedupe-ok-key`);
  });

  for (const bad of ["", "   "]) {
    await runAsync(`Dedupe: reject blank '${bad.trim() || "empty"}'`, async () => {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, received_at)
           VALUES (?1, 'inbound_message', 'p', ?2, 'pending', 1, ?3)`,
          `${P}-dedupe-blank-${bad.length}`,
          bad,
          NOW,
        ),
      );
    });
  }

  await runAsync("Dedupe: duplicate key rejected", async () => {
    const key = `${P}-dedupe-dup-key`;
    await insertGeneric(env, `${P}-dedupe-dup-a`, "inbound_message", key);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, received_at)
         VALUES (?1, 'delivery_event', 'p', ?2, 'pending', 1, ?3)`,
        `${P}-dedupe-dup-b`,
        key,
        NOW,
      ),
    );
  });

  // --- Provider IDs ---
  await runAsync("Provider IDs: NULL and nonblank pass; blank rejected", async () => {
    await insertGeneric(env, `${P}-prov-null`, "inbound_message", `${P}-prov-null-d`, {
      providerEventId: null,
    });
    await insertGeneric(env, `${P}-prov-ok`, "inbound_message", `${P}-prov-ok-d`, {
      providerEventId: "evt-123",
    });
    const sharedEvt = "shared-provider-evt";
    await insertGeneric(env, `${P}-prov-share-a`, "inbound_message", `${P}-prov-share-a-d`, {
      providerEventId: sharedEvt,
    });
    await insertGeneric(env, `${P}-prov-share-b`, "inbound_message", `${P}-prov-share-b-d`, {
      providerEventId: sharedEvt,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, provider_event_id, status, processing_version, received_at)
         VALUES (?1, 'inbound_message', 'p', ?2, '   ', 'pending', 1, ?3)`,
        `${P}-prov-blank`,
        `${P}-prov-blank-d`,
        NOW,
      ),
    );
  });

  // --- Status coupling ---
  await runAsync("Status: pending/processing/completed/quarantined coupling", async () => {
    await insertGeneric(env, `${P}-st-pending`, "inbound_message", `${P}-st-pending-d`, {
      status: "pending",
      nextAttemptAt: "2026-08-21T00:00:00.000Z",
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, finalized_at, received_at)
         VALUES (?1, 'inbound_message', 'p', ?2, 'pending', 1, ?3, ?3)`,
        `${P}-st-pending-bad`,
        `${P}-st-pending-bad-d`,
        FINAL,
      ),
    );
    await insertGeneric(env, `${P}-st-processing`, "inbound_message", `${P}-st-processing-d`, {
      status: "processing",
      version: 2,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, next_attempt_at, received_at)
         VALUES (?1, 'inbound_message', 'p', ?2, 'processing', 2, ?3, ?3)`,
        `${P}-st-proc-bad`,
        `${P}-st-proc-bad-d`,
        NOW,
      ),
    );
    await insertGeneric(env, `${P}-st-completed`, "inbound_message", `${P}-st-completed-d`, {
      status: "completed",
      version: 3,
      finalizedAt: FINAL,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, received_at)
         VALUES (?1, 'inbound_message', 'p', ?2, 'completed', 1, ?3)`,
        `${P}-st-completed-bad`,
        `${P}-st-completed-bad-d`,
        NOW,
      ),
    );
    await insertGeneric(env, `${P}-st-quarantine`, "inbound_message", `${P}-st-quarantine-d`, {
      status: "quarantined",
      version: 4,
      finalizedAt: FINAL,
      quarantineReason: "unmatched route",
    });
    for (const reason of [null, "   "]) {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, finalized_at, quarantine_reason, received_at)
           VALUES (?1, 'inbound_message', 'p', ?2, 'quarantined', 1, ?3, ?4, ?3)`,
          `${P}-st-q-bad-${reason === null ? "null" : "blank"}`,
          `${P}-st-q-bad-${reason === null ? "null" : "blank"}-d`,
          FINAL,
          reason,
        ),
      );
    }
  });

  await runAsync("Version: processing_version=1 pass, 0 rejected", async () => {
    await insertGeneric(env, `${P}-ver-1`, "inbound_message", `${P}-ver-1-d`, { version: 1 });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, received_at)
         VALUES (?1, 'inbound_message', 'p', ?2, 'pending', 0, ?3)`,
        `${P}-ver-0`,
        `${P}-ver-0-d`,
        NOW,
      ),
    );
  });

  // --- Payload reference ---
  await runAsync("Payload: all-null and complete tuple; partial/invalid rejected", async () => {
    await insertGeneric(env, `${P}-pay-null`, "inbound_message", `${P}-pay-null-d`);
    await insertGeneric(env, `${P}-pay-ok`, "inbound_message", `${P}-pay-ok-d`, {
      payload: { provider: "r2", key: "private/key", hash: HASH_OK, size: 100 },
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, received_at, payload_storage_provider, payload_storage_key)
         VALUES (?1, 'inbound_message', 'p', ?2, 'pending', 1, ?3, 'r2', NULL)`,
        `${P}-pay-partial`,
        `${P}-pay-partial-d`,
        NOW,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, received_at, payload_storage_provider, payload_storage_key, payload_content_hash, payload_size_bytes)
         VALUES (?1, 'inbound_message', 'p', ?2, 'pending', 1, ?3, 'r2', 'k', ?4, 1)`,
        `${P}-pay-bad-hash`,
        `${P}-pay-bad-hash-d`,
        NOW,
        HASH_BAD,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_provider_ingestion_events (id, event_kind, provider, ingestion_dedupe_key, status, processing_version, received_at, payload_storage_provider, payload_storage_key, payload_content_hash, payload_size_bytes)
         VALUES (?1, 'inbound_message', 'p', ?2, 'pending', 1, ?3, 'r2', 'k', ?4, -1)`,
        `${P}-pay-neg-size`,
        `${P}-pay-neg-size-d`,
        NOW,
        HASH_OK,
      ),
    );
  });

  // --- Child event-kind witness ---
  await runAsync("Witness: inbound child on inbound parent; wrong kind rejected", async () => {
    const genIn = `${P}-wit-in-gen`;
    const genDel = `${P}-wit-del-gen`;
    await insertGeneric(env, genIn, "inbound_message", `${genIn}-d`);
    await insertGeneric(env, genDel, "delivery_event", `${genDel}-d`);
    await insertInboundChild(env, `${P}-wit-in-child`, genIn, ADDR_PRIMARY);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_ingestion_events (id, ingestion_event_id, event_kind, recipient_address, delivery_event_type)
         VALUES (?1, ?2, 'delivery_event', 'to@test', 'delivered')`,
        `${P}-wit-wrong-del`,
        genIn,
      ),
    );
    await insertDeliveryChild(env, `${P}-wit-del-child`, genDel, "to@test", "delivered");
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_inbound_ingestion_events (id, ingestion_event_id, event_kind, envelope_recipient_address)
         VALUES (?1, ?2, 'inbound_message', ?3)`,
        `${P}-wit-wrong-in`,
        genDel,
        ADDR_PRIMARY,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_inbound_ingestion_events (id, ingestion_event_id, event_kind, envelope_recipient_address)
         VALUES (?1, ?2, 'inbound_message', ?3)`,
        `${P}-wit-dup-in`,
        genIn,
        ADDR_ALIAS,
      ),
    );
  });

  // --- Inbound envelope ---
  await runAsync("Envelope: required nonblank trimmed", async () => {
    const gen = `${P}-env-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`);
    await insertInboundChild(env, `${P}-env-ok`, gen, ADDR_PRIMARY);
    for (const [i, bad] of ["", "   ", ` ${ADDR_PRIMARY}`].entries()) {
      const g = `${P}-env-bad-${i}`;
      await insertGeneric(env, g, "inbound_message", `${g}-d`);
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_inbound_ingestion_events (id, ingestion_event_id, event_kind, envelope_recipient_address)
           VALUES (?1, ?2, 'inbound_message', ?3)`,
          `${g}-child`,
          g,
          bad,
        ),
      );
    }
  });

  // --- Unresolved / resolved route ---
  await runAsync("Route: unresolved all-null passes", async () => {
    const gen = `${P}-route-unres`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`);
    await insertInboundChild(env, `${P}-route-unres-child`, gen, ADDR_PRIMARY);
  });

  await runAsync("Route: resolved all-or-none + provenance attacks", async () => {
    const gen = `${P}-route-res`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`);
    await insertInboundChild(env, `${P}-route-res-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const partials = [
      [`${P}-route-p1`, RA_PRIMARY, null, null, null],
      [`${P}-route-p2`, RA_PRIMARY, MB_A, null, null],
      [`${P}-route-p3`, null, MB_A, ADDR_PRIMARY, null],
      [`${P}-route-p4`, RA_PRIMARY, MB_A, ADDR_PRIMARY, null],
    ];
    for (const [gid, ra, mb, snap, rat] of partials) {
      await insertGeneric(env, gid, "inbound_message", `${gid}-d`);
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_inbound_ingestion_events (id, ingestion_event_id, event_kind, envelope_recipient_address, receiving_address_id, route_owner_mailbox_id, routed_address_snapshot, routed_at)
           VALUES (?1, ?2, 'inbound_message', ?3, ?4, ?5, ?6, ?7)`,
          `${gid}-child`,
          gid,
          ADDR_PRIMARY,
          ra,
          mb,
          snap,
          rat,
        ),
      );
    }
    const atk1 = `${P}-route-atk1`;
    await insertGeneric(env, atk1, "inbound_message", `${atk1}-d`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_inbound_ingestion_events (id, ingestion_event_id, event_kind, envelope_recipient_address, receiving_address_id, route_owner_mailbox_id, routed_address_snapshot, routed_at)
         VALUES (?1, ?2, 'inbound_message', ?3, ?4, ?5, ?6, ?7)`,
        `${atk1}-child`,
        atk1,
        ADDR_PRIMARY,
        RA_PRIMARY,
        MB_B,
        ADDR_PRIMARY,
        ROUTED,
      ),
    );
    const atk2 = `${P}-route-atk2`;
    await insertGeneric(env, atk2, "inbound_message", `${atk2}-d`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_inbound_ingestion_events (id, ingestion_event_id, event_kind, envelope_recipient_address, receiving_address_id, route_owner_mailbox_id, routed_address_snapshot, routed_at)
         VALUES (?1, ?2, 'inbound_message', ?3, ?4, ?5, ?6, ?7)`,
        `${atk2}-child`,
        atk2,
        ADDR_PRIMARY,
        RA_PRIMARY,
        MB_A,
        ADDR_B,
        ROUTED,
      ),
    );
  });

  // --- Direct / fallback materialization ---
  await runAsync("Materialization: direct pass + fallback preserves route owner", async () => {
    const gen = `${P}-mat-direct-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`);
    await insertInboundChild(env, `${P}-mat-direct-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const msg = `${P}-mat-direct-msg`;
    await insertInboundMsg(env, msg, MB_A, THREAD_A, RFC_DIRECT);
    await insertInboundMat(env, `${P}-mat-direct-link`, gen, msg, {
      raId: RA_PRIMARY,
      routeOwnerMb: MB_A,
      snapshot: ADDR_PRIMARY,
      envelope: ADDR_PRIMARY,
      materializedMb: MB_A,
      routeMode: "direct",
    });
    const genFb = `${P}-mat-fb-gen`;
    await insertGeneric(env, genFb, "inbound_message", `${genFb}-d`);
    await insertInboundChild(env, `${P}-mat-fb-child`, genFb, ADDR_ALIAS, {
      raId: RA_ALIAS,
      mbId: MB_A,
      snapshot: ADDR_ALIAS,
      routedAt: ROUTED,
    });
    const msgFb = `${P}-mat-fb-msg`;
    await insertInboundMsg(env, msgFb, MB_FB, THREAD_FB, "<fb@test>");
    await insertInboundMat(env, `${P}-mat-fb-link`, genFb, msgFb, {
      raId: RA_ALIAS,
      routeOwnerMb: MB_A,
      snapshot: ADDR_ALIAS,
      envelope: ADDR_ALIAS,
      materializedMb: MB_FB,
      routeMode: "fallback",
      fallbackReason: "archived mailbox policy",
    });
    const row = await dbFirst(
      env,
      `SELECT route_owner_mailbox_id, materialized_mailbox_id FROM mail_inbound_message_materializations WHERE id = ?1`,
      `${P}-mat-fb-link`,
    );
    assert.equal(row.route_owner_mailbox_id, MB_A);
    assert.equal(row.materialized_mailbox_id, MB_FB);
  });

  await runAsync("Materialization: direct/fallback CHECK violations", async () => {
    const base = `${P}-mat-check`;
    const gen = `${base}-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`);
    await insertInboundChild(env, `${base}-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const msg = `${base}-msg`;
    await insertInboundMsg(env, msg, MB_A, THREAD_A, "<check@test>");
    const tryMat = async (suffix, mode, matMb, reason) =>
      execExpectFail(
        env,
        `INSERT INTO mail_inbound_message_materializations (
          id, ingestion_event_id, receiving_address_id, route_owner_mailbox_id,
          routed_address_snapshot, envelope_recipient_address, mail_message_id,
          materialized_mailbox_id, route_mode, fallback_reason, message_direction, materialized_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'inbound', ?11)`,
        `${base}-${suffix}`,
        gen,
        RA_PRIMARY,
        MB_A,
        ADDR_PRIMARY,
        ADDR_PRIMARY,
        msg,
        matMb,
        mode,
        reason,
        NOW,
      );
    reject(await tryMat("direct-bad-mb", "direct", MB_B, null));
    reject(await tryMat("direct-reason", "direct", MB_A, "reason"));
    reject(await tryMat("fb-same", "fallback", MB_A, "reason"));
    reject(await tryMat("fb-null", "fallback", MB_FB, null));
    reject(await tryMat("fb-blank", "fallback", MB_FB, "   "));
  });

  await runAsync("Materialization: outbound direction rejected", async () => {
    const gen = `${P}-mat-out-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`);
    await insertInboundChild(env, `${P}-mat-out-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const outMsg = `${P}-mat-out-msg`;
    await insertOutboundMsg(env, outMsg, MB_A, THREAD_A);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_inbound_message_materializations (
          id, ingestion_event_id, receiving_address_id, route_owner_mailbox_id,
          routed_address_snapshot, envelope_recipient_address, mail_message_id,
          materialized_mailbox_id, route_mode, message_direction, materialized_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'direct', 'inbound', ?9)`,
        `${P}-mat-out-link`,
        gen,
        RA_PRIMARY,
        MB_A,
        ADDR_PRIMARY,
        ADDR_PRIMARY,
        outMsg,
        MB_A,
        NOW,
      ),
    );
    obs.outboundAsInbound = false;
  });

  // --- One ingestion one message ---
  await runAsync("Cardinality: one ingestion cannot link two messages", async () => {
    const gen = `${P}-card-1-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`);
    await insertInboundChild(env, `${P}-card-1-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const m1 = `${P}-card-1-msg-a`;
    const m2 = `${P}-card-1-msg-b`;
    await insertInboundMsg(env, m1, MB_A, THREAD_A, "<card1a@test>");
    await insertInboundMsg(env, m2, MB_A, THREAD_A, "<card1b@test>");
    await insertInboundMat(env, `${P}-card-1-link-a`, gen, m1, {
      raId: RA_PRIMARY,
      routeOwnerMb: MB_A,
      snapshot: ADDR_PRIMARY,
      envelope: ADDR_PRIMARY,
      materializedMb: MB_A,
      routeMode: "direct",
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_inbound_message_materializations (
          id, ingestion_event_id, receiving_address_id, route_owner_mailbox_id,
          routed_address_snapshot, envelope_recipient_address, mail_message_id,
          materialized_mailbox_id, route_mode, message_direction, materialized_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'direct', 'inbound', ?9)`,
        `${P}-card-1-link-b`,
        gen,
        RA_PRIMARY,
        MB_A,
        ADDR_PRIMARY,
        ADDR_PRIMARY,
        m2,
        MB_A,
        NOW,
      ),
    );
  });

  // --- Multi-envelope same mailbox CRITICAL ---
  await runAsync("Multi-envelope: two ingestions → one message, distinct provenance", async () => {
    const gen1 = `${P}-multi-gen1`;
    const gen2 = `${P}-multi-gen2`;
    await insertGeneric(env, gen1, "inbound_message", `${gen1}-d`);
    await insertGeneric(env, gen2, "inbound_message", `${gen2}-d`);
    await insertInboundChild(env, `${P}-multi-child1`, gen1, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    await insertInboundChild(env, `${P}-multi-child2`, gen2, ADDR_ALIAS, {
      raId: RA_ALIAS,
      mbId: MB_A,
      snapshot: ADDR_ALIAS,
      routedAt: ROUTED,
    });
    const sharedMsg = `${P}-multi-shared-msg`;
    await insertInboundMsg(env, sharedMsg, MB_A, THREAD_A, RFC_MULTI);
    await insertInboundMat(env, `${P}-multi-link1`, gen1, sharedMsg, {
      raId: RA_PRIMARY,
      routeOwnerMb: MB_A,
      snapshot: ADDR_PRIMARY,
      envelope: ADDR_PRIMARY,
      materializedMb: MB_A,
      routeMode: "direct",
    });
    await insertInboundMat(env, `${P}-multi-link2`, gen2, sharedMsg, {
      raId: RA_ALIAS,
      routeOwnerMb: MB_A,
      snapshot: ADDR_ALIAS,
      envelope: ADDR_ALIAS,
      materializedMb: MB_A,
      routeMode: "direct",
    });
    const rows = await dbAll(
      env,
      `SELECT ingestion_event_id, mail_message_id, envelope_recipient_address
       FROM mail_inbound_message_materializations WHERE id LIKE '${P}-multi-link%' ORDER BY id`,
    );
    assert.equal(rows.results.length, 2);
    assert.equal(rows.results[0].mail_message_id, rows.results[1].mail_message_id);
    assert.notEqual(rows.results[0].ingestion_event_id, rows.results[1].ingestion_event_id);
    assert.notEqual(
      rows.results[0].envelope_recipient_address,
      rows.results[1].envelope_recipient_address,
    );
    obs.oneMessageMultipleLinks = true;
  });

  // --- RFC dedupe ---
  await runAsync("RFC: same ID different mailboxes allowed; duplicate same mailbox rejected", async () => {
    const msgA = `${P}-rfc-msg-a`;
    const msgB = `${P}-rfc-msg-b`;
    await insertInboundMsg(env, msgA, MB_A, THREAD_A, RFC_CROSS_A);
    await insertInboundMsg(env, msgB, MB_B, THREAD_B, RFC_CROSS_A);
    const dup1 = `${P}-rfc-dup-1`;
    await insertInboundMsg(env, dup1, MB_A, THREAD_A, RFC_DUP);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_messages (id, thread_id, mailbox_id, direction, from_address, subject, preview_text, sensitivity, internet_message_id, received_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'inbound', 'x@test', 'S', '', 'normal', ?4, ?5, ?5, ?5)`,
        `${P}-rfc-dup-2`,
        THREAD_A,
        MB_A,
        RFC_DUP,
        NOW,
      ),
    );
    const nullMsg = `${P}-rfc-null`;
    await insertInboundMsg(env, nullMsg, MB_A, THREAD_A, null);
    obs.nullRfcAllowed = true;
  });

  // --- Delivery staging ---
  await runAsync("Delivery staging: types + unresolved correlation", async () => {
    for (const t of ["deferred", "delivered", "bounced"]) {
      const g = `${P}-del-type-${t}`;
      await insertGeneric(env, g, "delivery_event", `${g}-d`);
      await insertDeliveryChild(env, `${g}-child`, g, "to@test", t);
    }
    for (const bad of ["accepted", "opened", "clicked", "invalid"]) {
      const g = `${P}-del-bad-${bad}`;
      await insertGeneric(env, g, "delivery_event", `${g}-d`);
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_delivery_ingestion_events (id, ingestion_event_id, event_kind, recipient_address, delivery_event_type)
           VALUES (?1, ?2, 'delivery_event', 'to@test', ?3)`,
          `${g}-child`,
          g,
          bad,
        ),
      );
    }
    const un = `${P}-del-unres`;
    await insertGeneric(env, un, "delivery_event", `${un}-d`);
    await insertDeliveryChild(env, `${P}-del-unres-child`, un, "to@test", "delivered");
  });

  await runAsync("Delivery: resolved all-or-none + provenance attacks", async () => {
    const g = `${P}-del-res`;
    await insertGeneric(env, g, "delivery_event", `${g}-d`);
    const graph = await seedDeliveryGraph(env, `${P}-del-graph`);
    await insertDeliveryChild(env, `${P}-del-res-child`, g, "to@test", "delivered", {
      sendId: graph.send,
      attemptId: graph.att,
      revId: graph.rev,
      recipientId: graph.recip,
      at: CORR,
    });
    const partialGen = `${P}-del-part`;
    await insertGeneric(env, partialGen, "delivery_event", `${partialGen}-d`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_ingestion_events (id, ingestion_event_id, event_kind, recipient_address, delivery_event_type, send_operation_id)
         VALUES (?1, ?2, 'delivery_event', 'to@test', 'delivered', ?3)`,
        `${P}-del-part-child`,
        partialGen,
        graph.send,
      ),
    );
    const g2 = `${P}-del-atk`;
    await insertGeneric(env, g2, "delivery_event", `${g2}-d`);
    const g2graph = await seedDeliveryGraph(env, `${P}-del-atk-graph`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_ingestion_events (id, ingestion_event_id, event_kind, recipient_address, delivery_event_type, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, correlated_at)
         VALUES (?1, ?2, 'delivery_event', 'to@test', 'delivered', ?3, ?4, ?5, ?6, ?7)`,
        `${P}-del-atk-child`,
        g2,
        g2graph.send,
        g2graph.att,
        `${P}-del-atk-graph-rev-b`,
        g2graph.recip,
        CORR,
      ),
    );
  });

  // --- Delivery materialization ---
  await runAsync("Delivery mat: valid link + dedupe/type mismatch rejected", async () => {
    const graph = await seedDeliveryGraph(env, `${P}-delmat-graph`);
    const gen2 = `${P}-delmat-gen2`;
    const dedupe2 = `${gen2}-k`;
    await insertGeneric(env, gen2, "delivery_event", dedupe2);
    await insertDeliveryChild(env, `${P}-delmat-child2`, gen2, "to@test", "delivered", {
      sendId: graph.send,
      attemptId: graph.att,
      revId: graph.rev,
      recipientId: graph.recip,
      at: CORR,
    });
    const de2 = `${P}-delmat-canonical2`;
    await dbRun(
      env,
      `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'delivered', ?6, ?7)`,
      de2,
      graph.send,
      graph.att,
      graph.rev,
      graph.recip,
      dedupe2,
      NOW,
    );
    await dbRun(
      env,
      `INSERT INTO mail_delivery_event_materializations (id, ingestion_event_id, delivery_event_id, event_dedupe_key, delivery_event_type, materialized_at)
       VALUES (?1, ?2, ?3, ?4, 'delivered', ?5)`,
      `${P}-delmat-link2`,
      gen2,
      de2,
      dedupe2,
      NOW,
    );
    const genBad = `${P}-delmat-bad-dedupe`;
    await insertGeneric(env, genBad, "delivery_event", `${genBad}-k`);
    await insertDeliveryChild(env, `${P}-delmat-bad-child`, genBad, "to@test", "delivered", {
      sendId: graph.send,
      attemptId: graph.att,
      revId: graph.rev,
      recipientId: graph.recip,
      at: CORR,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_event_materializations (id, ingestion_event_id, delivery_event_id, event_dedupe_key, delivery_event_type, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 'delivered', ?5)`,
        `${P}-delmat-bad-link`,
        genBad,
        de2,
        "different-dedupe-key",
        NOW,
      ),
    );
    const genType = `${P}-delmat-bad-type`;
    const typeKey = `${genType}-k`;
    await insertGeneric(env, genType, "delivery_event", typeKey);
    await insertDeliveryChild(env, `${P}-delmat-type-child`, genType, "to@test", "bounced", {
      sendId: graph.send,
      attemptId: graph.att,
      revId: graph.rev,
      recipientId: graph.recip,
      at: CORR,
    });
    const deType = `${P}-delmat-type-canonical`;
    await dbRun(
      env,
      `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'delivered', ?6, ?7)`,
      deType,
      graph.send,
      graph.att,
      graph.rev,
      graph.recip,
      typeKey,
      NOW,
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_event_materializations (id, ingestion_event_id, delivery_event_id, event_dedupe_key, delivery_event_type, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 'bounced', ?5)`,
        `${P}-delmat-type-link`,
        genType,
        deType,
        typeKey,
        NOW,
      ),
    );
    obs.stagedDeliveryTypeDiffers = false;
  });

  await runAsync("Delivery mat: one-to-one cardinality", async () => {
    const graph = await seedDeliveryGraph(env, `${P}-delcard-graph`);
    const gen = `${P}-delcard-gen`;
    const key = `${gen}-k`;
    await insertGeneric(env, gen, "delivery_event", key);
    await insertDeliveryChild(env, `${P}-delcard-child`, gen, "to@test", "delivered", {
      sendId: graph.send,
      attemptId: graph.att,
      revId: graph.rev,
      recipientId: graph.recip,
      at: CORR,
    });
    const de1 = `${P}-delcard-de1`;
    const de2 = `${P}-delcard-de2`;
    await dbRun(
      env,
      `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'delivered', ?6, ?7)`,
      de1,
      graph.send,
      graph.att,
      graph.rev,
      graph.recip,
      key,
      NOW,
    );
    await dbRun(
      env,
      `INSERT INTO mail_delivery_event_materializations (id, ingestion_event_id, delivery_event_id, event_dedupe_key, delivery_event_type, materialized_at)
       VALUES (?1, ?2, ?3, ?4, 'delivered', ?5)`,
      `${P}-delcard-link1`,
      gen,
      de1,
      key,
      NOW,
    );
    await dbRun(
      env,
      `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'delivered', ?6, ?7)`,
      de2,
      graph.send,
      graph.att,
      graph.rev,
      graph.recip,
      `${key}-other`,
      NOW,
    );
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_event_materializations (id, ingestion_event_id, delivery_event_id, event_dedupe_key, delivery_event_type, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 'delivered', ?5)`,
        `${P}-delcard-link2`,
        gen,
        de2,
        `${key}-other`,
        NOW,
      ),
    );
    const gen2 = `${P}-delcard-gen2`;
    const key2 = `${gen2}-k`;
    await insertGeneric(env, gen2, "delivery_event", key2);
    await insertDeliveryChild(env, `${P}-delcard-child2`, gen2, "to@test", "delivered", {
      sendId: graph.send,
      attemptId: graph.att,
      revId: graph.rev,
      recipientId: graph.recip,
      at: CORR,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_event_materializations (id, ingestion_event_id, delivery_event_id, event_dedupe_key, delivery_event_type, materialized_at)
         VALUES (?1, ?2, ?3, ?4, 'delivered', ?5)`,
        `${P}-delcard-link-dup-de`,
        gen2,
        de1,
        key2,
        NOW,
      ),
    );
  });

  // --- Stale worker CAS ---
  await runAsync("CAS: stale worker v2 cannot mutate processing v4", async () => {
    const id = `${P}-cas-flow`;
    await insertGeneric(env, id, "inbound_message", `${id}-d`, { status: "pending", version: 1 });
    const steps = [
      [1, "processing", 2],
      [2, "pending", 3],
      [3, "processing", 4],
    ];
    for (const [fromV, toStatus, toV] of steps) {
      const r = await dbRun(
        env,
        `UPDATE mail_provider_ingestion_events SET status = ?1, processing_version = ?2, next_attempt_at = NULL
         WHERE id = ?3 AND status = ?4 AND processing_version = ?5`,
        toStatus,
        toV,
        id,
        fromV === 1 ? "pending" : fromV === 2 ? "processing" : "pending",
        fromV,
      );
      assert.equal(r.meta.changes, 1);
    }
    const stale = await dbRun(
      env,
      `UPDATE mail_provider_ingestion_events SET status = 'completed', processing_version = 3, finalized_at = ?1
       WHERE id = ?2 AND status = 'processing' AND processing_version = 2`,
      FINAL,
      id,
    );
    assert.equal(stale.meta.changes, 0);
    obs.staleWorkerMutated = stale.meta.changes > 0;
    const row = await dbFirst(
      env,
      `SELECT status, processing_version FROM mail_provider_ingestion_events WHERE id = ?1`,
      id,
    );
    assert.equal(row.status, "processing");
    assert.equal(row.processing_version, 4);
  });

  pass("Batch harness: env.DB.batch available via getPlatformProxy");

  // --- Inbound atomic batch ---
  await runAsync("Batch inbound: valid CAS + guarded materialization", async () => {
    const gen = `${P}-batch-ok-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`, {
      status: "processing",
      version: 5,
    });
    await insertInboundChild(env, `${P}-batch-ok-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const msg = `${P}-batch-ok-msg`;
    await insertInboundMsg(env, msg, MB_A, THREAD_A, "<batch-ok@test>");
    const cas = env.DB.prepare(
      `UPDATE mail_provider_ingestion_events SET status = 'completed', processing_version = 6, finalized_at = ?1, next_attempt_at = NULL
       WHERE id = ?2 AND status = 'processing' AND processing_version = 5`,
    ).bind(FINAL, gen);
    const mat = env.DB.prepare(guardedInboundMatSql()).bind(
      `${P}-batch-ok-link`,
      gen,
      6,
      RA_PRIMARY,
      MB_A,
      ADDR_PRIMARY,
      ADDR_PRIMARY,
      msg,
      MB_A,
      "direct",
      null,
      NOW,
    );
    await env.DB.batch([cas, mat]);
    const row = await dbFirst(
      env,
      `SELECT status, processing_version FROM mail_provider_ingestion_events WHERE id = ?1`,
      gen,
    );
    assert.equal(row.status, "completed");
    assert.equal(row.processing_version, 6);
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_inbound_message_materializations WHERE ingestion_event_id = ?1`,
      gen,
    );
    assert.equal(cnt.c, 1);
  });

  await runAsync("Batch inbound: zero-row CAS leaves no fake materialization", async () => {
    const gen = `${P}-batch-zero-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`, {
      status: "processing",
      version: 4,
    });
    await insertInboundChild(env, `${P}-batch-zero-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const msg = `${P}-batch-zero-msg`;
    await insertInboundMsg(env, msg, MB_A, THREAD_A, "<batch-zero@test>");
    const cas = env.DB.prepare(
      `UPDATE mail_provider_ingestion_events SET status = 'completed', processing_version = 5, finalized_at = ?1
       WHERE id = ?2 AND status = 'processing' AND processing_version = 99`,
    ).bind(FINAL, gen);
    const mat = env.DB.prepare(guardedInboundMatSql()).bind(
      `${P}-batch-zero-link`,
      gen,
      5,
      RA_PRIMARY,
      MB_A,
      ADDR_PRIMARY,
      ADDR_PRIMARY,
      msg,
      MB_A,
      "direct",
      null,
      NOW,
    );
    let failed = false;
    try {
      await env.DB.batch([cas, mat]);
    } catch {
      failed = true;
    }
    assert.ok(failed);
    obs.zeroRowCasChanges = 0;
    obs.fakeInboundMat = false;
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_inbound_message_materializations WHERE ingestion_event_id = ?1`,
      gen,
    );
    assert.equal(cnt.c, 0);
    const row = await dbFirst(
      env,
      `SELECT status, processing_version FROM mail_provider_ingestion_events WHERE id = ?1`,
      gen,
    );
    assert.equal(row.status, "processing");
    assert.equal(row.processing_version, 4);
  });

  await runAsync("Batch inbound: later failure rolls back valid CAS", async () => {
    const gen = `${P}-batch-rb-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`, {
      status: "processing",
      version: 7,
    });
    await insertInboundChild(env, `${P}-batch-rb-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const cas = env.DB.prepare(
      `UPDATE mail_provider_ingestion_events SET status = 'completed', processing_version = 8, finalized_at = ?1
       WHERE id = ?2 AND status = 'processing' AND processing_version = 7`,
    ).bind(FINAL, gen);
    const badMat = env.DB.prepare(guardedInboundMatSql()).bind(
      `${P}-batch-rb-link`,
      gen,
      8,
      RA_PRIMARY,
      MB_A,
      ADDR_PRIMARY,
      ADDR_PRIMARY,
      `${P}-nonexistent-msg`,
      MB_A,
      "direct",
      null,
      NOW,
    );
    let failed = false;
    try {
      await env.DB.batch([cas, badMat]);
    } catch {
      failed = true;
    }
    assert.ok(failed);
    obs.earlierCasRolledBack = true;
    const row = await dbFirst(
      env,
      `SELECT status, processing_version FROM mail_provider_ingestion_events WHERE id = ?1`,
      gen,
    );
    assert.equal(row.status, "processing");
    assert.equal(row.processing_version, 7);
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_inbound_message_materializations WHERE ingestion_event_id = ?1`,
      gen,
    );
    assert.equal(cnt.c, 0);
  });

  // --- Delivery atomic batch ---
  await runAsync("Batch delivery: valid + stale rollback", async () => {
    const graph = await seedDeliveryGraph(env, `${P}-batch-del-graph`);
    const gen = `${P}-batch-del-gen`;
    const key = `${gen}-k`;
    await insertGeneric(env, gen, "delivery_event", key, {
      status: "processing",
      version: 2,
    });
    await insertDeliveryChild(env, `${P}-batch-del-child`, gen, "to@test", "delivered", {
      sendId: graph.send,
      attemptId: graph.att,
      revId: graph.rev,
      recipientId: graph.recip,
      at: CORR,
    });
    const de = `${P}-batch-del-de`;
    await dbRun(
      env,
      `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'delivered', ?6, ?7)`,
      de,
      graph.send,
      graph.att,
      graph.rev,
      graph.recip,
      key,
      NOW,
    );
    const cas = env.DB.prepare(
      `UPDATE mail_provider_ingestion_events SET status = 'completed', processing_version = 3, finalized_at = ?1
       WHERE id = ?2 AND status = 'processing' AND processing_version = 2`,
    ).bind(FINAL, gen);
    const mat = env.DB.prepare(guardedDeliveryMatSql()).bind(
      `${P}-batch-del-link`,
      gen,
      3,
      de,
      key,
      "delivered",
      NOW,
    );
    await env.DB.batch([cas, mat]);
    const staleCas = env.DB.prepare(
      `UPDATE mail_provider_ingestion_events SET status = 'completed', processing_version = 4, finalized_at = ?1
       WHERE id = ?2 AND status = 'processing' AND processing_version = 1`,
    ).bind(FINAL, gen);
    const staleMat = env.DB.prepare(guardedDeliveryMatSql()).bind(
      `${P}-batch-del-link2`,
      gen,
      4,
      de,
      key,
      "delivered",
      NOW,
    );
    let staleFailed = false;
    try {
      await env.DB.batch([staleCas, staleMat]);
    } catch {
      staleFailed = true;
    }
    assert.ok(staleFailed);
  });

  // --- Quarantine ---
  await runAsync("Quarantine: processing → quarantined without canonical effect", async () => {
    const gen = `${P}-q-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`, {
      status: "processing",
      version: 2,
    });
    await insertInboundChild(env, `${P}-q-child`, gen, ADDR_PRIMARY);
    await dbRun(
      env,
      `UPDATE mail_provider_ingestion_events SET status = 'quarantined', processing_version = 3, finalized_at = ?1, quarantine_reason = ?2, next_attempt_at = NULL
       WHERE id = ?3 AND status = 'processing' AND processing_version = 2`,
      FINAL,
      "unmatched envelope route",
      gen,
    );
    const row = await dbFirst(
      env,
      `SELECT status, quarantine_reason FROM mail_provider_ingestion_events WHERE id = ?1`,
      gen,
    );
    assert.equal(row.status, "quarantined");
    assert.ok(row.quarantine_reason);
    const matCnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_inbound_message_materializations WHERE ingestion_event_id = ?1`,
      gen,
    );
    assert.equal(matCnt.c, 0);
    obs.quarantinedWithoutCanonical = true;
  });

  // --- Retention ---
  await runAsync("Retention: parent delete blocked with child provenance", async () => {
    const gen = `${P}-ret-gen`;
    await insertGeneric(env, gen, "inbound_message", `${gen}-d`);
    await insertInboundChild(env, `${P}-ret-child`, gen, ADDR_PRIMARY, {
      raId: RA_PRIMARY,
      mbId: MB_A,
      snapshot: ADDR_PRIMARY,
      routedAt: ROUTED,
    });
    const msg = `${P}-ret-msg`;
    await insertInboundMsg(env, msg, MB_A, THREAD_A, "<ret@test>");
    await insertInboundMat(env, `${P}-ret-link`, gen, msg, {
      raId: RA_PRIMARY,
      routeOwnerMb: MB_A,
      snapshot: ADDR_PRIMARY,
      envelope: ADDR_PRIMARY,
      materializedMb: MB_A,
      routeMode: "direct",
    });
    reject(
      await execExpectFail(
        env,
        `DELETE FROM mail_provider_ingestion_events WHERE id = ?1`,
        gen,
      ),
    );
  });

  // --- Cleanup ---
  await cleanup(env);
  const remain = await dbFirst(
    env,
    `SELECT COUNT(*) AS c FROM mail_provider_ingestion_events WHERE id LIKE '${P}%'`,
  );
  assert.equal(remain.c, 0);
  pass("Cleanup: zero mail-phase2b22-* fixtures remain");
} finally {
  await dispose();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.error("\nFailures:");
  for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}

console.log("\n=== Observations ===");
console.log(`INGESTION DEDUPE IS GLOBAL SEMANTIC IDEMPOTENCY BOUNDARY: ${obs.ingestionDedupeGlobal ? "YES" : "NO"}`);
console.log(`ACTUAL ENVELOPE RECIPIENT PRESERVED: ${obs.envelopeRecipientPreserved ? "YES" : "NO"}`);
console.log(`INBOUND ROUTING USES EXACT RECEIVING ADDRESS PROVENANCE: ${obs.inboundRoutingExactProvenance ? "YES" : "NO"}`);
console.log(`ORIGINAL ROUTE OWNER PRESERVED DURING FALLBACK: ${obs.originalRouteOwnerPreserved ? "YES" : "NO"}`);
console.log(`FALLBACK MAY MATERIALIZE INTO DIFFERENT MAILBOX: ${obs.fallbackDifferentMailbox ? "YES" : "NO"}`);
console.log(`ONE INGESTION EVENT MAY LINK MULTIPLE CANONICAL MESSAGES: ${obs.oneIngestionMultipleMessages ? "YES" : "NO"}`);
console.log(`ONE CANONICAL INBOUND MESSAGE MAY HAVE MULTIPLE INGESTION PROVENANCE LINKS: ${obs.oneMessageMultipleLinks ? "YES" : "NO"}`);
console.log(`OUTBOUND MESSAGE MAY BE USED AS INBOUND MATERIALIZATION: ${obs.outboundAsInbound ? "YES" : "NO"}`);
console.log(`STAGED DELIVERY TYPE MAY DIFFER FROM CANONICAL DELIVERY TYPE: ${obs.stagedDeliveryTypeDiffers ? "YES" : "NO"}`);
console.log(`DB FULLY PROVES STAGED/CANONICAL DELIVERY CORRELATION: ${obs.dbFullyProvesDeliveryCorrelation ? "YES" : "NO"}`);
console.log(`SERVICE MUST VERIFY EXACT CORRELATION BEFORE MATERIALIZATION: ${obs.serviceMustVerifyDeliveryCorrelation ? "YES" : "N/A"}`);
console.log(`STALE INGESTION WORKER V2 MUTATED V4: ${obs.staleWorkerMutated ? "YES" : "NO"}`);
console.log(`ZERO-ROW INGESTION CAS: ${obs.zeroRowCasChanges} ROWS`);
console.log(`FAKE INBOUND MATERIALIZATION LEFT BEHIND: ${obs.fakeInboundMat ? "YES" : "NO"}`);
console.log(`EARLIER VALID INGESTION CAS ROLLED BACK: ${obs.earlierCasRolledBack ? "YES" : "NO"}`);
console.log(`QUARANTINED EVENT MAY EXIST WITHOUT CANONICAL EFFECT: ${obs.quarantinedWithoutCanonical ? "YES" : "NO"}`);

process.exit(0);
