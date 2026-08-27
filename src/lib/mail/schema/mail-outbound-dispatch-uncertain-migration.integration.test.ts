import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const ROOT = process.cwd();
const ALL_MIGRATIONS_DIR = join(ROOT, "drizzle/migrations");
const NOW = "2026-08-27T04:00:00.000Z";
const CONTENT_HASH = "b".repeat(64);
const USER_ID = "11111111-1111-1111-1111-111111111111";
const MAILBOX_ID = "22222222-2222-2222-2222-222222222222";
const SENDER_ID = "33333333-3333-3333-3333-333333333333";
const DRAFT_ID = "55555555-5555-5555-5555-555555555555";
const REVISION_PENDING = "66666666-6666-6666-6666-666666666601";
const REVISION_PROCESSING = "66666666-6666-6666-6666-666666666602";
const REVISION_ACCEPTED = "66666666-6666-6666-6666-666666666603";
const REVISION_FAILED = "66666666-6666-6666-6666-666666666604";
const REVISION_UNCERTAIN = "66666666-6666-6666-6666-666666666605";
const REVISION_UNCERTAIN_INVALID = "66666666-6666-6666-6666-666666666606";

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

const cleanupDirs: string[] = [];
let env: MigrationTestEnv;

function migrationNumber(fileName: string): number {
  return Number.parseInt(fileName.slice(0, 4), 10);
}

function copyMigrations(maxMigration?: number): string {
  const migrationsDir = mkdtempSync(join(tmpdir(), "crm-mig-0068-files-"));
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
  const persistDir = mkdtempSync(join(tmpdir(), "crm-mig-0068-persist-"));
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
          database_id: `test-0068-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function seedRevision(targetEnv: MigrationTestEnv, revisionId: string, draftSuffix: string): void {
  const draftId = `${DRAFT_ID.slice(0, -2)}${draftSuffix}`;
  const snapshotId = `44444444-4444-4444-4444-${draftSuffix}${draftSuffix}`;
  d1Exec(
    targetEnv,
    `
INSERT INTO mail_signature_snapshots (
  id, sender_identity_id, body_text, snapshot_hash, created_at
) VALUES (
  '${snapshotId}', '${SENDER_ID}', '', '${CONTENT_HASH}', '${NOW}'
);

INSERT INTO mail_drafts (
  id, author_user_id, mailbox_id, sender_identity_id, subject, body_text,
  sensitivity, compose_mode, autosave_version, last_saved_at, created_at, updated_at
) VALUES (
  '${draftId}', '${USER_ID}', '${MAILBOX_ID}', '${SENDER_ID}', 'Subject', 'Body',
  'normal', 'new', 1, '${NOW}', '${NOW}', '${NOW}'
);

INSERT INTO mail_outbound_revisions (
  id, revision_chain_id, revision_number, source_draft_id, revision_kind,
  created_by_user_id, created_at, mailbox_id, sender_identity_id,
  from_address, subject, body_text, sensitivity, compose_mode,
  signature_snapshot_id, content_hash, hash_version
) VALUES (
  '${revisionId}', '${revisionId}', 1, '${draftId}', 'admin_direct',
  '${USER_ID}', '${NOW}', '${MAILBOX_ID}', '${SENDER_ID}',
  'admin@test.local', 'Subject', 'Body', 'normal', 'new',
  '${snapshotId}', '${CONTENT_HASH}', 1
);
`.trim(),
  );
}

function seedBaseGraph(targetEnv: MigrationTestEnv): void {
  d1Exec(
    targetEnv,
    `
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES (
  '${USER_ID}', 'admin@test.local', 'Admin', 'hash', 'admin', 1,
  0, NULL, '${NOW}', '${NOW}'
);

INSERT OR IGNORE INTO mail_mailboxes (
  id, address, display_name, mailbox_type, status, created_at, updated_at
) VALUES (
  '${MAILBOX_ID}', 'admin@test.local', 'Admin', 'personal', 'active',
  '${NOW}', '${NOW}'
);

INSERT OR IGNORE INTO mail_sender_identities (
  id, address, display_name, status, default_mailbox_id, sent_folder_mailbox_id,
  created_at, updated_at
) VALUES (
  '${SENDER_ID}', 'admin@test.local', 'Admin', 'active',
  '${MAILBOX_ID}', '${MAILBOX_ID}', '${NOW}', '${NOW}'
);
`.trim(),
  );

  for (const [revisionId, suffix] of [
    [REVISION_PENDING, "01"],
    [REVISION_PROCESSING, "02"],
    [REVISION_ACCEPTED, "03"],
    [REVISION_FAILED, "04"],
    [REVISION_UNCERTAIN, "05"],
    [REVISION_UNCERTAIN_INVALID, "06"],
  ] as const) {
    seedRevision(targetEnv, revisionId, suffix);
  }
}

describe("mail outbound dispatch uncertain migration integration", () => {
  before(() => {
    env = createEnv(68);
    wrangler(env, ["migrations", "apply"]);
    seedBaseGraph(env);
  });

  after(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("schema accepts legacy send operation statuses after 0068", () => {
    d1Exec(
      env,
      `
INSERT INTO mail_send_operations (
  id, outbound_revision_id, revision_chain_id, content_hash, hash_version,
  revision_kind, authorization_mode, idempotency_key, status,
  orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at
) VALUES
  ('send-pending-0068', '${REVISION_PENDING}', '${REVISION_PENDING}', '${CONTENT_HASH}', 1,
   'admin_direct', 'admin_direct', 'idem-pending-0068', 'pending', 1, '${USER_ID}', '${NOW}', NULL, NULL),
  ('send-processing-0068', '${REVISION_PROCESSING}', '${REVISION_PROCESSING}', '${CONTENT_HASH}', 1,
   'admin_direct', 'admin_direct', 'idem-processing-0068', 'processing', 1, '${USER_ID}', '${NOW}', NULL, NULL),
  ('send-accepted-0068', '${REVISION_ACCEPTED}', '${REVISION_ACCEPTED}', '${CONTENT_HASH}', 1,
   'admin_direct', 'admin_direct', 'idem-accepted-0068', 'accepted', 1, '${USER_ID}', '${NOW}', '${NOW}', NULL),
  ('send-failed-0068', '${REVISION_FAILED}', '${REVISION_FAILED}', '${CONTENT_HASH}', 1,
   'admin_direct', 'admin_direct', 'idem-failed-0068', 'failed', 1, '${USER_ID}', '${NOW}', '${NOW}', NULL);
`.trim(),
    );

    const rows = d1Query<{ status: string }>(
      env,
      `SELECT status FROM mail_send_operations ORDER BY status`,
    );
    assert.deepEqual(
      rows.map((row) => row.status),
      ["accepted", "failed", "pending", "processing"],
    );
  });

  it("schema accepts legacy transport attempt states after 0068", () => {
    d1Exec(
      env,
      `
INSERT INTO mail_transport_attempts (
  id, send_operation_id, attempt_number, state, provider,
  provider_message_id, started_at, completed_at
) VALUES
  ('attempt-started-0068', 'send-processing-0068', 1, 'started', 'fake-local', NULL, '${NOW}', NULL),
  ('attempt-accepted-0068', 'send-accepted-0068', 1, 'accepted', 'fake-local', '<accepted@echfronthk.com>', '${NOW}', '${NOW}'),
  ('attempt-temp-0068', 'send-failed-0068', 1, 'temporary_failure', 'fake-local', NULL, '${NOW}', '${NOW}'),
  ('attempt-perm-0068', 'send-failed-0068', 2, 'permanent_failure', 'fake-local', NULL, '${NOW}', '${NOW}');
`.trim(),
    );

    const rows = d1Query<{ state: string }>(
      env,
      `SELECT state FROM mail_transport_attempts ORDER BY state`,
    );
    assert.deepEqual(
      rows.map((row) => row.state).sort(),
      ["accepted", "permanent_failure", "started", "temporary_failure"],
    );
  });

  it("accepts dispatch_uncertain send operation", () => {
    d1Exec(
      env,
      `
INSERT INTO mail_send_operations (
  id, outbound_revision_id, revision_chain_id, content_hash, hash_version,
  revision_kind, authorization_mode, idempotency_key, status,
  orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at
) VALUES (
  'send-uncertain-0068', '${REVISION_UNCERTAIN}', '${REVISION_UNCERTAIN}', '${CONTENT_HASH}', 1,
  'admin_direct', 'admin_direct', 'idem-uncertain-0068', 'dispatch_uncertain',
  2, '${USER_ID}', '${NOW}', '${NOW}', NULL
);
`.trim(),
    );
    const [row] = d1Query<{ status: string }>(
      env,
      `SELECT status FROM mail_send_operations WHERE id = 'send-uncertain-0068'`,
    );
    assert.equal(row?.status, "dispatch_uncertain");
  });

  it("accepts ambiguous transport attempt without provider_message_id", () => {
    d1Exec(
      env,
      `
INSERT INTO mail_transport_attempts (
  id, send_operation_id, attempt_number, state, provider,
  started_at, completed_at, error_code
) VALUES (
  'attempt-ambiguous-0068', 'send-uncertain-0068', 1, 'ambiguous', 'fake-local',
  '${NOW}', '${NOW}', 'outbound_dispatch_uncertain'
);
`.trim(),
    );
    const [row] = d1Query<{ state: string; provider_message_id: string | null }>(
      env,
      `SELECT state, provider_message_id FROM mail_transport_attempts WHERE id = 'attempt-ambiguous-0068'`,
    );
    assert.equal(row?.state, "ambiguous");
    assert.equal(row?.provider_message_id, null);
  });

  it("rejects dispatch_uncertain without completed_at", () => {
    const output = d1ExecAllowFailure(
      env,
      `
INSERT INTO mail_send_operations (
  id, outbound_revision_id, revision_chain_id, content_hash, hash_version,
  revision_kind, authorization_mode, idempotency_key, status,
  orchestration_version, initiated_by_user_id, created_at, completed_at, next_attempt_at
) VALUES (
  'send-uncertain-invalid', '${REVISION_UNCERTAIN_INVALID}', '${REVISION_UNCERTAIN_INVALID}', '${CONTENT_HASH}', 1,
  'admin_direct', 'admin_direct', 'idem-uncertain-invalid', 'dispatch_uncertain',
  1, '${USER_ID}', '${NOW}', NULL, NULL
);
`.trim(),
    );
    assert.match(output, /CHECK constraint failed/i);
  });
});
