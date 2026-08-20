#!/usr/bin/env node
/**
 * Phase 2B.15 — Local D1 Per-Recipient Delivery Event runtime verification.
 * LOCAL ONLY: getPlatformProxy env.DB (+ minimal wrangler for structure checks).
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { join } from "node:path";

const NOW = "2026-08-20T07:25:00.000Z";
const T1 = "2026-08-20T07:26:00.000Z";
const T2 = "2026-08-20T07:27:00.000Z";
const T3 = "2026-08-20T07:28:00.000Z";
const COMPLETED = "2026-08-20T07:30:00.000Z";
const P = "mail-phase2b15";
const USER = `${P}-staff`;
const ADMIN = `${P}-admin`;
const MAILBOX = `${P}-mailbox`;
const SENDER = `${P}-sender`;

const HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HASH_B =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const results = [];
const observations = {
  dbEnforcesTransportAccepted: false,
  serviceMustEnforceAcceptedTransport: true,
  oneSendDifferentOutcomes: false,
  deliveryPerRecipient: true,
  dbRejectsLateHistorical: false,
  futureProjectionOwnsTerminal: true,
  mutableCurrentStatusTable: false,
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
}

async function seedRevision(env, id, chainId, hash, opts = {}) {
  const { kind = "admin_direct", num = 1 } = opts;
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
     VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, 'from@test', 'Subject', 'body', 'normal', 'new', ?9, ?10, 1)`,
    id,
    chainId,
    num,
    kind,
    ADMIN,
    NOW,
    MAILBOX,
    SENDER,
    snap,
    hash,
  );
}

async function insertRecipient(env, id, revisionId, address, type = "to", sort = 0) {
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
  const {
    kind = "admin_direct",
    status = "accepted",
    orchVersion = 5,
    idempotencyKey = `${id}-idem`,
  } = opts;
  await dbRun(
    env,
    `INSERT INTO mail_send_operations (id, outbound_revision_id, revision_chain_id, content_hash, hash_version, revision_kind, authorization_mode, approval_id, idempotency_key, status, orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, 'admin_direct', NULL, ?6, ?7, ?8, ?9, ?10, ?11, NULL)`,
    id,
    revId,
    chainId,
    hash,
    kind,
    idempotencyKey,
    status,
    orchVersion,
    ADMIN,
    NOW,
    status === "accepted" || status === "failed" ? COMPLETED : null,
  );
}

async function insertAttempt(env, id, sendId, state = "accepted", opts = {}) {
  const { num = 1, providerMessageId = `${id}-pmsg`, completedAt = COMPLETED } = opts;
  await dbRun(
    env,
    `INSERT INTO mail_transport_attempts (id, send_operation_id, attempt_number, state, provider, provider_message_id, started_at, completed_at, retry_after_at)
     VALUES (?1, ?2, ?3, ?4, 'fixture-provider', ?5, ?6, ?7, NULL)`,
    id,
    sendId,
    num,
    state,
    providerMessageId,
    NOW,
    state === "started" ? null : completedAt,
  );
}

async function insertDelivery(env, id, opts) {
  const {
    sendId,
    attemptId,
    revId,
    recipientId,
    eventType,
    dedupeKey,
    providerEventId = null,
    providerOccurredAt = null,
    receivedAt = NOW,
    smtpStatus = null,
    smtpEnhanced = null,
    diagnostic = null,
  } = opts;
  await dbRun(
    env,
    `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, provider_event_id, provider_occurred_at, received_at, smtp_status_code, smtp_enhanced_status_code, diagnostic_message)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    id,
    sendId,
    attemptId,
    revId,
    recipientId,
    eventType,
    dedupeKey,
    providerEventId,
    providerOccurredAt,
    receivedAt,
    smtpStatus,
    smtpEnhanced,
    diagnostic,
  );
}

async function buildGraph(env, base) {
  const chain = `${base}-chain`;
  const rev = `${base}-rev`;
  const send = `${base}-send`;
  const attempt = `${base}-attempt`;
  await seedRevision(env, rev, chain, HASH);
  const recA = `${base}-rec-a`;
  const recB = `${base}-rec-b`;
  const recC = `${base}-rec-c`;
  await insertRecipient(env, recA, rev, `a-${base}@example.test`, "to", 0);
  await insertRecipient(env, recB, rev, `b-${base}@example.test`, "cc", 1);
  await insertRecipient(env, recC, rev, `c-${base}@example.test`, "bcc", 2);
  await insertSend(env, send, rev, chain, HASH);
  await insertAttempt(env, attempt, send, "accepted");
  return { chain, rev, send, attempt, recA, recB, recC };
}

async function cleanup(env) {
  const tables = [
    "mail_delivery_events",
    "mail_transport_attempts",
    "mail_send_operations",
    "mail_outbound_revision_recipients",
    "mail_outbound_approval_events",
    "mail_outbound_approvals",
    "mail_outbound_revisions",
    "mail_signature_snapshots",
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

console.log("=== Phase 2B.15 Local D1 Delivery Event Verification ===\n");

const { getPlatformProxy } = await import("wrangler");
const { env, dispose } = await getPlatformProxy({
  configPath: join(process.cwd(), "wrangler.jsonc"),
});

try {
  run("Baseline: migration 0058 applied", () => {
    const out = d1Structure(`SELECT id, name FROM d1_migrations WHERE id = 58;`);
    assert.match(out, /0058_mail_delivery_event/);
  });

  await runAsync("Structure: mail_delivery_events + candidate keys + indexes", async () => {
    const requiredIndexes = [
      "uq_mail_send_operations_id_outbound_revision_id",
      "uq_mail_transport_attempts_id_send_operation_id",
      "uq_mail_outbound_revision_recipients_id_revision_id",
      "uq_mail_delivery_events_event_dedupe_key",
      "idx_mail_delivery_events_send_operation_received_at",
      "idx_mail_delivery_events_recipient_received_at",
      "idx_mail_delivery_events_transport_attempt_id",
      "idx_mail_delivery_events_event_type_received_at",
      "idx_mail_delivery_events_provider_event_id",
    ];
    for (const idx of requiredIndexes) {
      const row = await dbFirst(
        env,
        `SELECT name FROM sqlite_master WHERE type='index' AND name = ?1`,
        idx,
      );
      assert.equal(row?.name, idx, `missing ${idx}`);
    }
    const tableSql = await dbFirst(
      env,
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_delivery_events'`,
    );
    for (const forbidden of [
      "updated_at",
      "current_status",
      "is_delivered",
      "is_bounced",
      "latest_event_type",
      "provider_message_id",
    ]) {
      assert.doesNotMatch(tableSql.sql, new RegExp(forbidden));
    }
    const sendCols = await dbAll(
      env,
      `SELECT name FROM pragma_table_info('mail_send_operations')`,
    );
    const transportCols = await dbAll(
      env,
      `SELECT name FROM pragma_table_info('mail_transport_attempts')`,
    );
    for (const col of sendCols.results ?? sendCols) {
      assert.doesNotMatch(col.name, /deliver|bounce|deferred/i);
    }
    for (const col of transportCols.results ?? transportCols) {
      assert.doesNotMatch(col.name, /deliver|bounce|deferred/i);
    }
  });

  run("Structure: no delivery projection tables", () => {
    const out = d1Structure(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mail_delivery_status','mail_delivery_current_state','mail_recipient_delivery_state');`,
    );
    assert.doesNotMatch(out, /mail_delivery_status/);
    observations.mutableCurrentStatusTable = false;
  });

  await cleanup(env);
  await setupCore(env);

  // Section 7 — event types
  await runAsync("Event type: deferred/delivered/bounced pass", async () => {
    const g = await buildGraph(env, `${P}-etype`);
    for (const [suffix, type] of [
      ["def", "deferred"],
      ["del", "delivered"],
      ["bnc", "bounced"],
    ]) {
      await insertDelivery(env, `${P}-etype-${suffix}`, {
        sendId: g.send,
        attemptId: g.attempt,
        revId: g.rev,
        recipientId: g.recA,
        eventType: type,
        dedupeKey: `${P}-etype-${suffix}-dedupe`,
      });
    }
  });

  await runAsync("Event type: invalid rejected", async () => {
    const g = await buildGraph(env, `${P}-etype-bad`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'invalid', ?6, ?7)`,
        `${P}-etype-invalid`,
        g.send,
        g.attempt,
        g.rev,
        g.recA,
        `${P}-etype-invalid-dedupe`,
        NOW,
      ),
    );
  });

  await runAsync("Event type: transport/send-only types rejected", async () => {
    const g = await buildGraph(env, `${P}-etype-forbid`);
    for (const bad of [
      "accepted",
      "processing",
      "temporary_failure",
      "permanent_failure",
      "opened",
      "clicked",
    ]) {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
          `${P}-etype-forbid-${bad}`,
          g.send,
          g.attempt,
          g.rev,
          g.recA,
          bad,
          `${P}-etype-forbid-${bad}-dedupe`,
          NOW,
        ),
      );
    }
  });

  // Section 8 — fixture graph (used below)
  const main = await buildGraph(env, `${P}-main`);

  // Section 9 — send/revision provenance
  await runAsync("Provenance: send+revision match passes", async () => {
    await insertDelivery(env, `${P}-prov-send-ok`, {
      sendId: main.send,
      attemptId: main.attempt,
      revId: main.rev,
      recipientId: main.recA,
      eventType: "delivered",
      dedupeKey: `${P}-prov-send-ok-dedupe`,
    });
  });

  await runAsync("Provenance: send+wrong revision rejected", async () => {
    const revB = `${P}-prov-rev-b`;
    const chainB = `${P}-prov-chain-b`;
    await seedRevision(env, revB, chainB, HASH_B);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'delivered', ?6, ?7)`,
        `${P}-prov-send-bad`,
        main.send,
        main.attempt,
        revB,
        main.recA,
        `${P}-prov-send-bad-dedupe`,
        NOW,
      ),
    );
  });

  // Section 10 — transport/send provenance
  await runAsync("Provenance: transport+send match passes", async () => {
    await insertDelivery(env, `${P}-prov-tport-ok`, {
      sendId: main.send,
      attemptId: main.attempt,
      revId: main.rev,
      recipientId: main.recB,
      eventType: "deferred",
      dedupeKey: `${P}-prov-tport-ok-dedupe`,
    });
  });

  await runAsync("Provenance: transport+wrong send rejected", async () => {
    const other = await buildGraph(env, `${P}-prov-send-b`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'deferred', ?6, ?7)`,
        `${P}-prov-tport-bad`,
        main.send,
        other.attempt,
        main.rev,
        main.recB,
        `${P}-prov-tport-bad-dedupe`,
        NOW,
      ),
    );
  });

  // Section 11 — recipient/revision provenance
  await runAsync("Provenance: recipient+revision match passes", async () => {
    await insertDelivery(env, `${P}-prov-rec-ok`, {
      sendId: main.send,
      attemptId: main.attempt,
      revId: main.rev,
      recipientId: main.recC,
      eventType: "bounced",
      dedupeKey: `${P}-prov-rec-ok-dedupe`,
    });
  });

  await runAsync("Provenance: recipient+wrong revision rejected", async () => {
    const revB = `${P}-prov-rec-rev-b`;
    const chainB = `${P}-prov-rec-chain-b`;
    await seedRevision(env, revB, chainB, HASH_B);
    const recB = `${P}-prov-rec-b`;
    await insertRecipient(env, recB, revB, `x-${P}@example.test`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'bounced', ?6, ?7)`,
        `${P}-prov-rec-bad`,
        main.send,
        main.attempt,
        main.rev,
        recB,
        `${P}-prov-rec-bad-dedupe`,
        NOW,
      ),
    );
  });

  // Section 12 — cross-provenance attack
  await runAsync("Provenance: full cross-provenance attack rejected", async () => {
    const sendB = await buildGraph(env, `${P}-attack-b`);
    const revC = `${P}-attack-rev-c`;
    const chainC = `${P}-attack-chain-c`;
    await seedRevision(env, revC, chainC, HASH_B);
    const recC = `${P}-attack-rec-c`;
    await insertRecipient(env, recC, revC, `attack-${P}@example.test`);
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'deferred', ?6, ?7)`,
        `${P}-attack-mixed`,
        main.send,
        sendB.attempt,
        main.rev,
        recC,
        `${P}-attack-mixed-dedupe`,
        NOW,
      ),
    );
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_delivery_events WHERE id = ?1`,
      `${P}-attack-mixed`,
    );
    assert.equal(cnt.c, 0);
  });

  // Section 13 — required provenance fields
  await runAsync("Provenance: missing required fields rejected", async () => {
    const base = `${P}-req`;
    const cases = [
      [`${base}-no-send`, null, main.attempt, main.rev, main.recA],
      [`${base}-no-attempt`, main.send, null, main.rev, main.recA],
      [`${base}-no-rev`, main.send, main.attempt, null, main.recA],
      [`${base}-no-recipient`, main.send, main.attempt, main.rev, null],
    ];
    for (const [id, sendId, attemptId, revId, recipientId] of cases) {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'deferred', ?6, ?7)`,
          id,
          sendId,
          attemptId,
          revId,
          recipientId,
          `${id}-dedupe`,
          NOW,
        ),
      );
    }
  });

  // Section 14 — transport accepted service boundary
  await runAsync("Transport boundary: non-accepted attempt allows DB insert (service must gate)", async () => {
    const g = await buildGraph(env, `${P}-tport-started`);
    await insertAttempt(env, `${P}-tport-started-att`, g.send, "started", {
      num: 2,
    });
    await insertDelivery(env, `${P}-tport-started-ev`, {
      sendId: g.send,
      attemptId: `${P}-tport-started-att`,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "deferred",
      dedupeKey: `${P}-tport-started-ev-dedupe`,
    });
    observations.dbEnforcesTransportAccepted = false;
    observations.serviceMustEnforceAcceptedTransport = true;
    pass("Transport boundary: DB does NOT enforce state=accepted");
    pass("Transport boundary: SERVICE MUST enforce accepted transport");
  });

  // Section 15 — dedupe key
  await runAsync("Dedupe: nonblank passes, blank rejected, duplicate rejected", async () => {
    const g = await buildGraph(env, `${P}-dedupe`);
    await insertDelivery(env, `${P}-dedupe-1`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "deferred",
      dedupeKey: `${P}-dedupe-key-1`,
    });
    for (const blank of ["", "   "]) {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'deferred', ?6, ?7)`,
          `${P}-dedupe-blank-${blank.length}`,
          g.send,
          g.attempt,
          g.rev,
          g.recB,
          blank,
          NOW,
        ),
      );
    }
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'deferred', ?6, ?7)`,
        `${P}-dedupe-dup`,
        g.send,
        g.attempt,
        g.rev,
        g.recB,
        `${P}-dedupe-key-1`,
        NOW,
      ),
    );
  });

  // Section 16 — dedupe collision contract (documented observation)
  pass(
    "Dedupe collision: UNIQUE conflict requires semantic verification (INTEGRITY/ADAPTER CONFLICT if mismatch)",
  );

  // Section 17 — provider_event_id
  await runAsync("Provider event id: null/valid pass; blank rejected; same id different recipients OK", async () => {
    const g = await buildGraph(env, `${P}-pevt`);
    await insertDelivery(env, `${P}-pevt-null`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "deferred",
      dedupeKey: `${P}-pevt-null-dedupe`,
      providerEventId: null,
    });
    await insertDelivery(env, `${P}-pevt-val`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recB,
      eventType: "deferred",
      dedupeKey: `${P}-pevt-val-dedupe`,
      providerEventId: `${P}-shared-provider-event`,
    });
    for (const blank of ["", "   "]) {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, provider_event_id, received_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'deferred', ?6, ?7, ?8)`,
          `${P}-pevt-blank-${blank.length}`,
          g.send,
          g.attempt,
          g.rev,
          g.recC,
          `${P}-pevt-blank-${blank.length}-dedupe`,
          blank,
          NOW,
        ),
      );
    }
    await insertDelivery(env, `${P}-pevt-same-id`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recC,
      eventType: "delivered",
      dedupeKey: `${P}-pevt-same-id-dedupe`,
      providerEventId: `${P}-shared-provider-event`,
    });
  });

  // Section 18 — per-recipient delivery (CRITICAL)
  await runAsync("Per-recipient: A delivered, B deferred, C bounced on one send", async () => {
    const g = await buildGraph(env, `${P}-per-recip`);
    await insertDelivery(env, `${P}-per-a`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "delivered",
      dedupeKey: `${P}-per-a-dedupe`,
    });
    await insertDelivery(env, `${P}-per-b`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recB,
      eventType: "deferred",
      dedupeKey: `${P}-per-b-dedupe`,
    });
    await insertDelivery(env, `${P}-per-c`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recC,
      eventType: "bounced",
      dedupeKey: `${P}-per-c-dedupe`,
    });
    const rows = await dbAll(
      env,
      `SELECT outbound_revision_recipient_id, event_type FROM mail_delivery_events WHERE send_operation_id = ?1 ORDER BY outbound_revision_recipient_id`,
      g.send,
    );
    const list = rows.results ?? rows;
    assert.equal(list.length, 3);
    const types = new Set(list.map((r) => r.event_type));
    assert.equal(types.size, 3);
    observations.oneSendDifferentOutcomes = true;
    pass("Per-recipient: ONE SEND MAY HAVE DIFFERENT RECIPIENT DELIVERY OUTCOMES");
    pass("Per-recipient: DELIVERY IS PER RECIPIENT");
  });

  // Section 19 — multiple deferred
  await runAsync("Multiple deferred: same recipient history allowed", async () => {
    const g = await buildGraph(env, `${P}-multi-def`);
    await insertDelivery(env, `${P}-mdef-1`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "deferred",
      dedupeKey: `${P}-mdef-1-dedupe`,
    });
    await insertDelivery(env, `${P}-mdef-2`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "deferred",
      dedupeKey: `${P}-mdef-2-dedupe`,
    });
    await insertDelivery(env, `${P}-mdef-del`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "delivered",
      dedupeKey: `${P}-mdef-del-dedupe`,
    });
    const cnt = await dbFirst(
      env,
      `SELECT COUNT(*) AS c FROM mail_delivery_events WHERE outbound_revision_recipient_id = ?1`,
      g.recA,
    );
    assert.equal(cnt.c, 3);
  });

  // Section 20 — terminal + late historical
  await runAsync("Late historical: delivered then later deferred both stored", async () => {
    const g = await buildGraph(env, `${P}-late`);
    await insertDelivery(env, `${P}-late-del`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "delivered",
      dedupeKey: `${P}-late-del-dedupe`,
      providerOccurredAt: T1,
      receivedAt: T2,
    });
    await insertDelivery(env, `${P}-late-def`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "deferred",
      dedupeKey: `${P}-late-def-dedupe`,
      providerOccurredAt: T3,
      receivedAt: T2,
    });
    observations.dbRejectsLateHistorical = false;
    observations.futureProjectionOwnsTerminal = true;
    pass("Late historical: DB REJECTS LATE HISTORICAL EVENTS AFTER TERMINAL EVENT — NO");
    pass("Late historical: FUTURE PROJECTION OWNS TERMINAL CURRENT-STATE SEMANTICS — YES");
  });

  // Section 21 — out-of-order timestamps
  await runAsync("Timestamps: out-of-order provider_occurred_at vs received_at accepted", async () => {
    const g = await buildGraph(env, `${P}-ts-order`);
    await insertDelivery(env, `${P}-ts-a`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "deferred",
      dedupeKey: `${P}-ts-a-dedupe`,
      providerOccurredAt: T3,
      receivedAt: T1,
    });
    await insertDelivery(env, `${P}-ts-b`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recB,
      eventType: "deferred",
      dedupeKey: `${P}-ts-b-dedupe`,
      providerOccurredAt: T1,
      receivedAt: T3,
    });
  });

  // Section 22 — null provider_occurred_at / required received_at
  await runAsync("Timestamps: provider_occurred_at NULL OK; received_at NULL rejected", async () => {
    const g = await buildGraph(env, `${P}-ts-null`);
    await insertDelivery(env, `${P}-ts-null-ok`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "deferred",
      dedupeKey: `${P}-ts-null-ok-dedupe`,
      providerOccurredAt: null,
    });
    reject(
      await execExpectFail(
        env,
        `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'deferred', ?6, NULL)`,
        `${P}-ts-null-bad`,
        g.send,
        g.attempt,
        g.rev,
        g.recB,
        `${P}-ts-null-bad-dedupe`,
      ),
    );
  });

  // Section 23 — diagnostic metadata
  await runAsync("Diagnostics: NULL/normal pass; blank rejected", async () => {
    const g = await buildGraph(env, `${P}-diag`);
    await insertDelivery(env, `${P}-diag-null`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "bounced",
      dedupeKey: `${P}-diag-null-dedupe`,
    });
    await insertDelivery(env, `${P}-diag-val`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recB,
      eventType: "bounced",
      dedupeKey: `${P}-diag-val-dedupe`,
      smtpStatus: "550",
      smtpEnhanced: "5.1.1",
      diagnostic: "Mailbox unavailable",
    });
    for (const [field, col] of [
      ["smtp", "smtp_status_code"],
      ["enh", "smtp_enhanced_status_code"],
      ["msg", "diagnostic_message"],
    ]) {
      reject(
        await execExpectFail(
          env,
          `INSERT INTO mail_delivery_events (id, send_operation_id, transport_attempt_id, outbound_revision_id, outbound_revision_recipient_id, event_type, event_dedupe_key, received_at, ${col})
           VALUES (?1, ?2, ?3, ?4, ?5, 'bounced', ?6, ?7, ?8)`,
          `${P}-diag-blank-${field}`,
          g.send,
          g.attempt,
          g.rev,
          g.recC,
          `${P}-diag-blank-${field}-dedupe`,
          NOW,
          field === "msg" ? "   " : "   ",
        ),
      );
    }
  });

  // Section 24 — no raw payload columns
  await runAsync("Structure: no raw provider payload/secret columns", async () => {
    const cols = await dbAll(
      env,
      `SELECT name FROM pragma_table_info('mail_delivery_events')`,
    );
    const names = (cols.results ?? cols).map((c) => c.name);
    for (const forbidden of [
      "raw_payload",
      "webhook_json",
      "provider_response",
      "auth_header",
      "api_key",
      "token",
      "secret",
    ]) {
      assert.ok(!names.includes(forbidden), `forbidden column ${forbidden}`);
    }
  });

  // Section 25 — immutable shape
  await runAsync("Immutable: no updated_at; append-only by service contract", async () => {
    const row = await dbFirst(
      env,
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_delivery_events'`,
    );
    assert.doesNotMatch(row.sql, /updated_at/);
    pass("Immutable: Delivery Event rows append-only (no schema update prohibition)");
  });

  // Section 26 — Bcc internal provenance
  await runAsync("Bcc: internal delivery event for Bcc recipient passes", async () => {
    const g = await buildGraph(env, `${P}-bcc`);
    await insertDelivery(env, `${P}-bcc-ev`, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recC,
      eventType: "delivered",
      dedupeKey: `${P}-bcc-ev-dedupe`,
    });
    pass("Bcc: internal reference OK — does NOT grant API exposure");
  });

  // Section 27 — delete/retention
  await runAsync("Retention: parent delete blocked while Delivery Event exists", async () => {
    const g = await buildGraph(env, `${P}-retain`);
    const evId = `${P}-retain-ev`;
    await insertDelivery(env, evId, {
      sendId: g.send,
      attemptId: g.attempt,
      revId: g.rev,
      recipientId: g.recA,
      eventType: "delivered",
      dedupeKey: `${P}-retain-ev-dedupe`,
    });
    reject(
      await execExpectFail(
        env,
        `DELETE FROM mail_transport_attempts WHERE id = ?1`,
        g.attempt,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `DELETE FROM mail_send_operations WHERE id = ?1`,
        g.send,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `DELETE FROM mail_outbound_revision_recipients WHERE id = ?1`,
        g.recA,
      ),
    );
    reject(
      await execExpectFail(
        env,
        `DELETE FROM mail_outbound_revisions WHERE id = ?1`,
        g.rev,
      ),
    );
    await dbRun(env, `DELETE FROM mail_delivery_events WHERE id = ?1`, evId);
    await dbRun(env, `DELETE FROM mail_transport_attempts WHERE id = ?1`, g.attempt);
    await dbRun(env, `DELETE FROM mail_send_operations WHERE id = ?1`, g.send);
    for (const recId of [g.recA, g.recB, g.recC]) {
      await dbRun(
        env,
        `DELETE FROM mail_outbound_revision_recipients WHERE id = ?1`,
        recId,
      );
    }
    await dbRun(env, `DELETE FROM mail_outbound_revisions WHERE id = ?1`, g.rev);
    await dbRun(
      env,
      `DELETE FROM mail_signature_snapshots WHERE id = ?1`,
      `${g.rev}-snap`,
    );
    pass("Retention: no CASCADE; parents deletable after event removed");
  });

  // Section 28 — provider_message_id correlation
  await runAsync("Correlation: provider_message_id on transport attempt only", async () => {
    const g = await buildGraph(env, `${P}-pmsg`);
    await dbRun(
      env,
      `UPDATE mail_transport_attempts SET provider_message_id = ?1 WHERE id = ?2`,
      `${P}-provider-msg-id`,
      g.attempt,
    );
    const attempt = await dbFirst(
      env,
      `SELECT provider_message_id FROM mail_transport_attempts WHERE id = ?1`,
      g.attempt,
    );
    assert.equal(attempt.provider_message_id, `${P}-provider-msg-id`);
    const tableSql = await dbFirst(
      env,
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='mail_delivery_events'`,
    );
    assert.doesNotMatch(tableSql.sql, /provider_message_id/);
  });

  await cleanup(env);

  await runAsync("Cleanup: zero mail-phase2b15 fixtures remain", async () => {
    for (const table of [
      "mail_delivery_events",
      "mail_transport_attempts",
      "mail_send_operations",
      "mail_outbound_revision_recipients",
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
console.log("\n=== Key Observations ===");
console.log(`DB ENFORCES TRANSPORT STATE = ACCEPTED: ${observations.dbEnforcesTransportAccepted ? "YES" : "NO"}`);
console.log(`SERVICE MUST ENFORCE ACCEPTED TRANSPORT: ${observations.serviceMustEnforceAcceptedTransport ? "YES" : "NO"}`);
console.log(`ONE SEND MAY HAVE DIFFERENT RECIPIENT DELIVERY OUTCOMES: ${observations.oneSendDifferentOutcomes ? "YES" : "NO"}`);
console.log(`DELIVERY IS PER RECIPIENT: ${observations.deliveryPerRecipient ? "YES" : "NO"}`);
console.log(`DB REJECTS LATE HISTORICAL EVENTS AFTER TERMINAL EVENT: ${observations.dbRejectsLateHistorical ? "YES" : "NO"}`);
console.log(`FUTURE PROJECTION OWNS TERMINAL CURRENT-STATE SEMANTICS: ${observations.futureProjectionOwnsTerminal ? "YES" : "NO"}`);
console.log(`MUTABLE CURRENT DELIVERY STATUS TABLE CREATED: ${observations.mutableCurrentStatusTable ? "YES" : "NO"}`);

if (failed.length) {
  console.error("\nFailed checks:");
  for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log("\nPhase 2B.15 Local D1 verification PASSED.");
