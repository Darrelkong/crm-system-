import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const ROOT = process.cwd();
const ALL_MIGRATIONS_DIR = join(ROOT, "drizzle/migrations");
const MIGRATION_0068 = join(
  ROOT,
  "drizzle/migrations/0068_mail_outbound_dispatch_uncertain.sql",
);
const NOW = "2026-08-27T08:00:00.000Z";
const CONTENT_HASH = "c".repeat(64);

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

const cleanupDirs: string[] = [];
let env: MigrationTestEnv;

const SENTINEL = {
  providerIngestion: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01",
  deliveryIngestion: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb01",
  deliveryEventMat: "cccccccc-cccc-cccc-cccc-ccccccccccc01",
  deliveryEvent: "dddddddd-dddd-dddd-dddd-dddddddddddd01",
  mailMessage: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee01",
  mailThread: "12121212-1212-1212-1212-121212121212",
  outboundMat: "ffffffff-ffff-ffff-ffff-fffffffffff01",
  rfcIdentity: "10101010-1010-1010-1010-101010101001",
  user: "11111111-1111-1111-1111-111111111111",
  mailbox: "22222222-2222-2222-2222-222222222222",
  sender: "33333333-3333-3333-3333-333333333333",
  revPending: "66666666-6666-6666-6666-666666666601",
  revProcessing: "66666666-6666-6666-6666-666666666602",
  revAccepted: "66666666-6666-6666-6666-666666666603",
  revFailed: "66666666-6666-6666-6666-666666666604",
  recipientPending: "77777777-7777-7777-7777-777777777701",
  recipientProcessing: "77777777-7777-7777-7777-777777777702",
  recipientAccepted: "77777777-7777-7777-7777-777777777703",
  recipientFailed: "77777777-7777-7777-7777-777777777704",
  sendPending: "send-0068r-pending",
  sendProcessing: "send-0068r-processing",
  sendAccepted: "send-0068r-accepted",
  sendFailed: "send-0068r-failed",
  attemptStarted: "attempt-0068r-started",
  attemptAccepted: "attempt-0068r-accepted",
  attemptTemp: "attempt-0068r-temp",
  attemptPerm: "attempt-0068r-perm",
};

function migrationNumber(fileName: string): number {
  return Number.parseInt(fileName.slice(0, 4), 10);
}

function copyMigrations(maxMigration?: number): string {
  const migrationsDir = mkdtempSync(join(tmpdir(), "crm-mig-0068r-files-"));
  cleanupDirs.push(migrationsDir);
  for (const fileName of readdirSync(ALL_MIGRATIONS_DIR).sort()) {
    if (!fileName.endsWith(".sql")) continue;
    if (maxMigration !== undefined && migrationNumber(fileName) > maxMigration) {
      continue;
    }
    writeFileSync(
      join(migrationsDir, fileName),
      readFileSync(join(ALL_MIGRATIONS_DIR, fileName), "utf8"),
    );
  }
  return migrationsDir;
}

function createEnv(maxMigration?: number): MigrationTestEnv {
  const persistDir = mkdtempSync(join(tmpdir(), "crm-mig-0068r-persist-"));
  const migrationsDir = copyMigrations(maxMigration);
  cleanupDirs.push(persistDir);
  const configPath = join(migrationsDir, "wrangler-test.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({
      d1_databases: [
        {
          binding: "DB",
          database_name: "crm-db",
          database_id: `test-0068r-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          migrations_dir: migrationsDir,
        },
      ],
    }),
  );
  return { persistDir, migrationsDir, configPath };
}

function wrangler(
  targetEnv: MigrationTestEnv,
  subcommand: string[],
  options: { allowFailure?: boolean } = {},
): string {
  const args = [
    "wrangler",
    "d1",
    ...subcommand,
    "crm-db",
    "--local",
    "--persist-to",
    targetEnv.persistDir,
    "-c",
    targetEnv.configPath,
  ];
  try {
    return execFileSync("npx", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
  } catch (error) {
    if (options.allowFailure) {
      const err = error as { stdout?: string; stderr?: string };
      return `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    throw error;
  }
}

function d1Query<T extends Record<string, unknown>>(
  targetEnv: MigrationTestEnv,
  sql: string,
): T[] {
  const output = wrangler(targetEnv, [
    "execute",
    "--command",
    sql.replace(/\s+/g, " ").trim(),
    "--json",
  ]);
  const parsed = JSON.parse(output) as Array<{ results: T[] }>;
  return parsed[0]?.results ?? [];
}

function d1Exec(targetEnv: MigrationTestEnv, sql: string): void {
  const sqlFile = join(
    targetEnv.migrationsDir,
    `exec-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  );
  writeFileSync(sqlFile, sql);
  try {
    wrangler(targetEnv, ["execute", "--file", sqlFile]);
  } finally {
    rmSync(sqlFile, { force: true });
  }
}

function d1ExecAllowFailure(targetEnv: MigrationTestEnv, sql: string): string {
  const sqlFile = join(
    targetEnv.migrationsDir,
    `exec-fail-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  );
  writeFileSync(sqlFile, sql);
  try {
    return wrangler(targetEnv, ["execute", "--file", sqlFile], {
      allowFailure: true,
    });
  } finally {
    rmSync(sqlFile, { force: true });
  }
}

function seedRevision(
  revisionId: string,
  draftSuffix: string,
  recipientId: string,
): string {
  const draftId = `55555555-5555-5555-5555-${draftSuffix}`;
  const snapshotId = `44444444-4444-4444-4444-${draftSuffix}${draftSuffix}`;
  return `
INSERT INTO mail_signature_snapshots (
  id, sender_identity_id, body_text, snapshot_hash, created_at
) VALUES (
  '${snapshotId}', '${SENTINEL.sender}', '', '${CONTENT_HASH}', '${NOW}'
);
INSERT INTO mail_drafts (
  id, author_user_id, mailbox_id, sender_identity_id, subject, body_text,
  sensitivity, compose_mode, autosave_version, last_saved_at, created_at, updated_at
) VALUES (
  '${draftId}', '${SENTINEL.user}', '${SENTINEL.mailbox}', '${SENTINEL.sender}',
  'Subject', 'Body', 'normal', 'new', 1, '${NOW}', '${NOW}', '${NOW}'
);
INSERT INTO mail_outbound_revisions (
  id, revision_chain_id, revision_number, source_draft_id, revision_kind,
  created_by_user_id, created_at, mailbox_id, sender_identity_id,
  from_address, subject, body_text, sensitivity, compose_mode,
  signature_snapshot_id, content_hash, hash_version
) VALUES (
  '${revisionId}', '${revisionId}', 1, '${draftId}', 'admin_direct',
  '${SENTINEL.user}', '${NOW}', '${SENTINEL.mailbox}', '${SENTINEL.sender}',
  'admin@test.local', 'Subject', 'Body', 'normal', 'new',
  '${snapshotId}', '${CONTENT_HASH}', 1
);
INSERT INTO mail_outbound_revision_recipients (
  id, revision_id, recipient_type, address, display_name, sort_order, created_at
) VALUES (
  '${recipientId}', '${revisionId}', 'to', 'client@example.com', NULL, 0, '${NOW}'
);
`;
}

function seedFullFixture(targetEnv: MigrationTestEnv): void {
  const base = `
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES (
  '${SENTINEL.user}', 'admin@test.local', 'Admin', 'hash', 'admin', 1,
  0, NULL, '${NOW}', '${NOW}'
);
INSERT INTO mail_mailboxes (
  id, address, display_name, mailbox_type, status, created_at, updated_at
) VALUES (
  '${SENTINEL.mailbox}', 'admin@test.local', 'Admin', 'personal', 'active',
  '${NOW}', '${NOW}'
);
INSERT INTO mail_sender_identities (
  id, address, display_name, status, default_mailbox_id, sent_folder_mailbox_id,
  created_at, updated_at
) VALUES (
  '${SENTINEL.sender}', 'admin@test.local', 'Admin', 'active',
  '${SENTINEL.mailbox}', '${SENTINEL.mailbox}', '${NOW}', '${NOW}'
);
${seedRevision(SENTINEL.revPending, "01", SENTINEL.recipientPending)}
${seedRevision(SENTINEL.revProcessing, "02", SENTINEL.recipientProcessing)}
${seedRevision(SENTINEL.revAccepted, "03", SENTINEL.recipientAccepted)}
${seedRevision(SENTINEL.revFailed, "04", SENTINEL.recipientFailed)}

INSERT INTO mail_send_operations (
  id, outbound_revision_id, revision_chain_id, content_hash, hash_version,
  revision_kind, authorization_mode, idempotency_key, status,
  orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at
) VALUES
  ('${SENTINEL.sendPending}', '${SENTINEL.revPending}', '${SENTINEL.revPending}', '${CONTENT_HASH}', 1,
   'admin_direct', 'admin_direct', 'idem-0068r-pending', 'pending', 1, '${SENTINEL.user}', '${NOW}', NULL, NULL),
  ('${SENTINEL.sendProcessing}', '${SENTINEL.revProcessing}', '${SENTINEL.revProcessing}', '${CONTENT_HASH}', 1,
   'admin_direct', 'admin_direct', 'idem-0068r-processing', 'processing', 2, '${SENTINEL.user}', '${NOW}', NULL, NULL),
  ('${SENTINEL.sendAccepted}', '${SENTINEL.revAccepted}', '${SENTINEL.revAccepted}', '${CONTENT_HASH}', 1,
   'admin_direct', 'admin_direct', 'idem-0068r-accepted', 'accepted', 3, '${SENTINEL.user}', '${NOW}', '${NOW}', NULL),
  ('${SENTINEL.sendFailed}', '${SENTINEL.revFailed}', '${SENTINEL.revFailed}', '${CONTENT_HASH}', 1,
   'admin_direct', 'admin_direct', 'idem-0068r-failed', 'failed', 1, '${SENTINEL.user}', '${NOW}', '${NOW}', NULL);

INSERT INTO mail_transport_attempts (
  id, send_operation_id, attempt_number, state, provider,
  provider_message_id, started_at, completed_at, retry_after_at, error_code
) VALUES
  ('${SENTINEL.attemptStarted}', '${SENTINEL.sendProcessing}', 1, 'started', 'fake-local',
   NULL, '${NOW}', NULL, NULL, NULL),
  ('${SENTINEL.attemptAccepted}', '${SENTINEL.sendAccepted}', 1, 'accepted', 'fake-local',
   '<provider-accepted@echfronthk.com>', '${NOW}', '${NOW}', NULL, NULL),
  ('${SENTINEL.attemptTemp}', '${SENTINEL.sendFailed}', 1, 'temporary_failure', 'fake-local',
   NULL, '${NOW}', '${NOW}', '${NOW}', 'temp'),
  ('${SENTINEL.attemptPerm}', '${SENTINEL.sendFailed}', 2, 'permanent_failure', 'fake-local',
   NULL, '${NOW}', '${NOW}', NULL, 'perm');

INSERT INTO mail_outbound_rfc_identities (
  id, send_operation_id, outbound_revision_id, rfc_message_id, created_at
) VALUES
  ('${SENTINEL.rfcIdentity}', '${SENTINEL.sendAccepted}', '${SENTINEL.revAccepted}',
   '<internal-rfc@echfronthk.com>', '${NOW}');

INSERT INTO mail_threads (
  id, mailbox_id, subject_normalized, last_message_at, created_at, updated_at
) VALUES (
  '${SENTINEL.mailThread}', '${SENTINEL.mailbox}', 'subject', '${NOW}', '${NOW}', '${NOW}'
);

INSERT INTO mail_messages (
  id, thread_id, mailbox_id, direction, sender_identity_id, from_address, subject,
  preview_text, internet_message_id, compose_mode, sent_at, created_at, updated_at
) VALUES (
  '${SENTINEL.mailMessage}', '${SENTINEL.mailThread}', '${SENTINEL.mailbox}', 'outbound',
  '${SENTINEL.sender}', 'admin@test.local', 'Subject', '', '<provider-accepted@echfronthk.com>',
  'new', '${NOW}', '${NOW}', '${NOW}'
);

INSERT INTO mail_outbound_message_materializations (
  id, send_operation_id, outbound_revision_id, content_hash, hash_version,
  accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id,
  wire_internet_message_id, mail_message_id, message_direction, materialized_at
) VALUES (
  '${SENTINEL.outboundMat}', '${SENTINEL.sendAccepted}', '${SENTINEL.revAccepted}',
  '${CONTENT_HASH}', 1, '${SENTINEL.attemptAccepted}', '${SENTINEL.rfcIdentity}',
  '<internal-rfc@echfronthk.com>', '<provider-accepted@echfronthk.com>',
  '${SENTINEL.mailMessage}', 'outbound', '${NOW}'
);

INSERT INTO mail_provider_ingestion_events (
  id, event_kind, provider, ingestion_dedupe_key, status, processing_version,
  received_at, finalized_at
) VALUES (
  '${SENTINEL.providerIngestion}', 'delivery_event', 'fake-local',
  'dedupe-0068r-sentinel', 'completed', 1, '${NOW}', '${NOW}'
);

INSERT INTO mail_delivery_ingestion_events (
  id, ingestion_event_id, event_kind, recipient_address, delivery_event_type,
  send_operation_id, transport_attempt_id, outbound_revision_id,
  outbound_revision_recipient_id, correlated_at
) VALUES (
  '${SENTINEL.deliveryIngestion}', '${SENTINEL.providerIngestion}', 'delivery_event',
  'client@example.com', 'delivered', '${SENTINEL.sendAccepted}',
  '${SENTINEL.attemptAccepted}', '${SENTINEL.revAccepted}', '${SENTINEL.recipientAccepted}', '${NOW}'
);

INSERT INTO mail_delivery_events (
  id, send_operation_id, transport_attempt_id, outbound_revision_id,
  outbound_revision_recipient_id, event_type, event_dedupe_key, received_at
) VALUES (
  '${SENTINEL.deliveryEvent}', '${SENTINEL.sendAccepted}', '${SENTINEL.attemptAccepted}',
  '${SENTINEL.revAccepted}', '${SENTINEL.recipientAccepted}', 'delivered',
  'delivery-dedupe-0068r', '${NOW}'
);

INSERT INTO mail_delivery_event_materializations (
  id, ingestion_event_id, delivery_event_id, event_dedupe_key,
  delivery_event_type, materialized_at
) VALUES (
  '${SENTINEL.deliveryEventMat}', '${SENTINEL.providerIngestion}',
  '${SENTINEL.deliveryEvent}', 'dedupe-0068r-sentinel', 'delivered', '${NOW}'
);
`;
  d1Exec(targetEnv, base);
}

type RowSnapshot = Record<string, unknown>;

function tableRows(targetEnv: MigrationTestEnv, table: string): RowSnapshot[] {
  return d1Query<RowSnapshot>(
    targetEnv,
    `SELECT * FROM ${table} ORDER BY id`,
  );
}

function normalizeCreateSql(sql: string): string {
  return sql
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .replace(/dispatch_uncertain/g, "__UNCERTAIN__")
    .replace(/'ambiguous'/g, "'__AMBIGUOUS__'")
    .trim();
}

describe("mail outbound dispatch uncertain migration D1 compatibility (2H-6N.1C-R)", () => {
  let beforeSnapshot: Record<string, RowSnapshot[]>;
  let beforeSchema: Record<string, string>;

  before(() => {
    const migrationSql = readFileSync(MIGRATION_0068, "utf8");
    assert.doesNotMatch(migrationSql, /PRAGMA\s+foreign_keys\s*=\s*OFF/i);
    assert.match(migrationSql, /PRAGMA\s+defer_foreign_keys\s*=\s*ON/i);

    env = createEnv(67);
    wrangler(env, ["migrations", "apply"]);
    seedFullFixture(env);

    const tables = [
      "mail_send_operations",
      "mail_transport_attempts",
      "mail_outbound_rfc_identities",
      "mail_outbound_message_materializations",
      "mail_delivery_events",
      "mail_delivery_ingestion_events",
      "mail_delivery_event_materializations",
      "mail_provider_ingestion_events",
    ];
    beforeSnapshot = Object.fromEntries(
      tables.map((table) => [table, tableRows(env, table)]),
    );
    beforeSchema = Object.fromEntries(
      tables.map((table) => {
        const [row] = d1Query<{ sql: string }>(
          env,
          `SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = '${table}'`,
        );
        return [table, row?.sql ?? ""];
      }),
    );

    d1Exec(env, readFileSync(MIGRATION_0068, "utf8"));
  });

  after(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("1: migration does not depend on foreign_keys=OFF", () => {
    assert.doesNotMatch(
      readFileSync(MIGRATION_0068, "utf8"),
      /PRAGMA\s+foreign_keys\s*=\s*OFF/i,
    );
  });

  it("2: complete non-empty FK graph row counts preserved", () => {
    for (const table of Object.keys(beforeSnapshot)) {
      const after = tableRows(env, table);
      assert.equal(
        after.length,
        beforeSnapshot[table]!.length,
        `${table} row count`,
      );
    }
  });

  it("3: cascade sentinel child rows preserved", () => {
    const provider = d1Query<{ id: string }>(
      env,
      `SELECT id FROM mail_provider_ingestion_events WHERE id = '${SENTINEL.providerIngestion}'`,
    );
    assert.equal(provider.length, 1);
    const deliveryMat = d1Query<{ id: string }>(
      env,
      `SELECT id FROM mail_delivery_event_materializations WHERE id = '${SENTINEL.deliveryEventMat}'`,
    );
    assert.equal(deliveryMat.length, 1);
  });

  it("4: row-level semantic preservation for send operations", () => {
    const after = tableRows(env, "mail_send_operations");
    for (const before of beforeSnapshot.mail_send_operations!) {
      const row = after.find((candidate) => candidate.id === before.id);
      assert.ok(row, `missing send ${String(before.id)}`);
      assert.equal(row.status, before.status);
      assert.equal(row.idempotency_key, before.idempotency_key);
      assert.equal(row.orchestration_version, before.orchestration_version);
      assert.equal(row.outbound_revision_id, before.outbound_revision_id);
    }
  });

  it("5: foreign_key_check returns zero violations", () => {
    const violations = d1Query<{ table: string; rowid: number }>(
      env,
      "PRAGMA foreign_key_check",
    );
    assert.deepEqual(violations, []);
  });

  it("6: accepts dispatch_uncertain and ambiguous after migration", () => {
    d1Exec(
      env,
      `
INSERT INTO mail_signature_snapshots (
  id, sender_identity_id, body_text, snapshot_hash, created_at
) VALUES (
  '44444444-4444-4444-4444-0505', '${SENTINEL.sender}', '', '${CONTENT_HASH}', '${NOW}'
);
INSERT INTO mail_drafts (
  id, author_user_id, mailbox_id, sender_identity_id, subject, body_text,
  sensitivity, compose_mode, autosave_version, last_saved_at, created_at, updated_at
) VALUES (
  '55555555-5555-5555-5555-05', '${SENTINEL.user}', '${SENTINEL.mailbox}', '${SENTINEL.sender}',
  'Subject', 'Body', 'normal', 'new', 1, '${NOW}', '${NOW}', '${NOW}'
);
INSERT INTO mail_outbound_revisions (
  id, revision_chain_id, revision_number, source_draft_id, revision_kind,
  created_by_user_id, created_at, mailbox_id, sender_identity_id,
  from_address, subject, body_text, sensitivity, compose_mode,
  signature_snapshot_id, content_hash, hash_version
) VALUES (
  '66666666-6666-6666-6666-666666666605', '66666666-6666-6666-6666-666666666605', 1,
  '55555555-5555-5555-5555-05', 'admin_direct', '${SENTINEL.user}', '${NOW}',
  '${SENTINEL.mailbox}', '${SENTINEL.sender}', 'admin@test.local', 'Subject', 'Body',
  'normal', 'new', '44444444-4444-4444-4444-0505', '${CONTENT_HASH}', 1
);
INSERT INTO mail_send_operations (
  id, outbound_revision_id, revision_chain_id, content_hash, hash_version,
  revision_kind, authorization_mode, idempotency_key, status,
  orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at
) VALUES (
  'send-0068r-uncertain', '66666666-6666-6666-6666-666666666605',
  '66666666-6666-6666-6666-666666666605', '${CONTENT_HASH}', 1,
  'admin_direct', 'admin_direct', 'idem-0068r-uncertain', 'dispatch_uncertain',
  4, '${SENTINEL.user}', '${NOW}', '${NOW}', NULL
);
INSERT INTO mail_transport_attempts (
  id, send_operation_id, attempt_number, state, provider, started_at, completed_at
) VALUES (
  'attempt-0068r-ambiguous', 'send-0068r-uncertain', 1, 'ambiguous', 'fake-local', '${NOW}', '${NOW}'
);
`.trim(),
    );
    const [send] = d1Query<{ status: string }>(
      env,
      `SELECT status FROM mail_send_operations WHERE id = 'send-0068r-uncertain'`,
    );
    const [attempt] = d1Query<{ state: string; provider_message_id: string | null }>(
      env,
      `SELECT state, provider_message_id FROM mail_transport_attempts WHERE id = 'attempt-0068r-ambiguous'`,
    );
    assert.equal(send?.status, "dispatch_uncertain");
    assert.equal(attempt?.state, "ambiguous");
    assert.equal(attempt?.provider_message_id, null);
  });

  it("7: rejects invalid status values", () => {
    const output = d1ExecAllowFailure(
      env,
      `
INSERT INTO mail_send_operations (
  id, outbound_revision_id, revision_chain_id, content_hash, hash_version,
  revision_kind, authorization_mode, idempotency_key, status,
  orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at
) VALUES (
  'send-0068r-invalid', '66666666-6666-6666-6666-666666666606',
  '66666666-6666-6666-6666-666666666606', '${CONTENT_HASH}', 1,
  'admin_direct', 'admin_direct', 'idem-0068r-invalid', 'totally_invalid',
  1, '${SENTINEL.user}', '${NOW}', NULL, NULL
);
`.trim(),
    );
    assert.match(output, /CHECK constraint failed/i);
  });

  it("8: started partial UNIQUE preserved", () => {
    const output = d1ExecAllowFailure(
      env,
      `
INSERT INTO mail_transport_attempts (
  id, send_operation_id, attempt_number, state, provider, started_at, completed_at
) VALUES (
  'attempt-0068r-dup-started', '${SENTINEL.sendProcessing}', 2, 'started', 'fake-local', '${NOW}', NULL
);
`.trim(),
    );
    assert.match(output, /UNIQUE constraint failed/i);
  });

  it("9: schema drift limited to status CHECK expansion", () => {
    for (const table of Object.keys(beforeSchema)) {
      const [row] = d1Query<{ sql: string }>(
        env,
        `SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = '${table}'`,
      );
      const beforeNorm = normalizeCreateSql(beforeSchema[table]!);
      const afterNorm = normalizeCreateSql(row?.sql ?? "");
      if (table === "mail_send_operations") {
        assert.match(afterNorm, /__UNCERTAIN__/);
        assert.doesNotMatch(beforeNorm, /__UNCERTAIN__/);
      } else if (table === "mail_transport_attempts") {
        assert.match(afterNorm, /__AMBIGUOUS__/);
        assert.doesNotMatch(beforeNorm, /__AMBIGUOUS__/);
      } else if (table === "mail_provider_ingestion_events") {
        assert.equal(beforeNorm, afterNorm);
      } else {
        assert.equal(beforeNorm, afterNorm, `unexpected drift in ${table}`);
      }
    }
  });

  it("10: required indexes exist after migration", () => {
    const indexes = d1Query<{ name: string }>(
      env,
      `SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name IN (
        'mail_send_operations','mail_transport_attempts','mail_outbound_rfc_identities',
        'mail_outbound_message_materializations','mail_delivery_events',
        'mail_delivery_ingestion_events','mail_delivery_event_materializations'
      ) ORDER BY name`,
    );
    const names = new Set(indexes.map((row) => row.name));
    for (const required of [
      "uq_mail_transport_attempts_one_started_per_send_operation",
      "uq_mail_send_operations_idempotency_key",
      "uq_mail_delivery_events_id_event_type",
      "uq_mail_delivery_event_materializations_ingestion_event_id",
    ]) {
      assert.ok(names.has(required), `missing index ${required}`);
    }
    const partial = d1Query<{ sql: string }>(
      env,
      `SELECT sql FROM sqlite_schema WHERE name = 'uq_mail_transport_attempts_one_started_per_send_operation'`,
    );
    assert.match(partial[0]?.sql ?? "", /WHERE state = 'started'/);
  });
});
