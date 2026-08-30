import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const ROOT = process.cwd();
const ALL_MIGRATIONS_DIR = join(ROOT, "drizzle/migrations");
const MIGRATION_0070 = join(
  ROOT,
  "drizzle/migrations/0070_mail_large_attachment_lifecycle.sql",
);
const NOW = "2026-08-30T10:00:00.000Z";
const DIRECT_HASH = "a".repeat(64);
const SECURE_HASH = "b".repeat(64);
const REV_HASH = "c".repeat(64);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const MAILBOX_ID = "22222222-2222-2222-2222-222222222222";
const SENDER_ID = "33333333-3333-3333-3333-333333333333";
const SNAPSHOT_ID = "44444444-4444-4444-4444-444444444444";
const DRAFT_ID = "55555555-5555-5555-5555-555555555555";
const REVISION_ID = "66666666-6666-6666-6666-666666666666";
const THREAD_ID = "77777777-7777-7777-7777-777777777777";
const MESSAGE_ID = "88888888-8888-8888-8888-888888888888";

const DIRECT_FILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01";
const SECURE_FILE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001";
const REV_FILE_ID = "cccccccc-cccc-cccc-cccc-cccccccccc01";

const DRAFT_DIRECT_ATT_ID = "dddddddd-dddd-dddd-dddd-dddddddddd01";
const DRAFT_SECURE_ATT_ID = "dddddddd-dddd-dddd-dddd-dddddddddd02";
const REV_ATT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01";
const MSG_DIRECT_ATT_ID = "ffffffff-ffff-ffff-ffff-fffffffffff01";
const MSG_SECURE_ATT_ID = "ffffffff-ffff-ffff-ffff-fffffffffff02";

const REBUILT_TABLES = [
  "mail_draft_attachments",
  "mail_outbound_revision_attachments",
  "mail_message_attachments",
] as const;

const EXPECTED_INDEXES: Record<(typeof REBUILT_TABLES)[number], string[]> = {
  mail_draft_attachments: ["idx_mail_draft_attachments_draft_id"],
  mail_outbound_revision_attachments: [
    "idx_mail_outbound_revision_attachments_revision_id",
    "idx_mail_outbound_revision_attachments_stored_file_id",
    "sqlite_autoindex_mail_outbound_revision_attachments_1",
  ],
  mail_message_attachments: [
    "idx_mail_message_attachments_message_id",
    "idx_mail_message_attachments_stored_file_id",
    "idx_mail_message_attachments_source_revision_attachment",
  ],
};

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

const cleanupDirs: string[] = [];

function migrationNumber(fileName: string): number {
  return Number.parseInt(fileName.slice(0, 4), 10);
}

function copyMigrations(maxMigration?: number): string {
  const migrationsDir = mkdtempSync(join(tmpdir(), "crm-mig-0070-files-"));
  cleanupDirs.push(migrationsDir);
  for (const fileName of readdirSync(ALL_MIGRATIONS_DIR).sort()) {
    if (!fileName.endsWith(".sql")) continue;
    if (maxMigration !== undefined && migrationNumber(fileName) > maxMigration) {
      continue;
    }
    cpSync(join(ALL_MIGRATIONS_DIR, fileName), join(migrationsDir, fileName));
  }
  return migrationsDir;
}

function createEnv(maxMigration?: number): MigrationTestEnv {
  const persistDir = mkdtempSync(join(tmpdir(), "crm-mig-0070-persist-"));
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
          database_id: `test-0070-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          migrations_dir: migrationsDir,
        },
      ],
    }),
  );
  return { persistDir, migrationsDir, configPath };
}

function wrangler(
  env: MigrationTestEnv,
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
    env.persistDir,
    "-c",
    env.configPath,
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

function applyMigrations(env: MigrationTestEnv): string {
  return wrangler(env, ["migrations", "apply"]);
}

function d1Query<T extends Record<string, unknown>>(
  env: MigrationTestEnv,
  sql: string,
): T[] {
  const output = wrangler(env, [
    "execute",
    "--command",
    sql.replace(/\s+/g, " ").trim(),
    "--json",
  ]);
  const parsed = JSON.parse(output) as Array<{ results: T[] }>;
  return parsed[0]?.results ?? [];
}

function d1Exec(env: MigrationTestEnv, sql: string): void {
  const sqlFile = join(
    env.migrationsDir,
    `exec-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  );
  writeFileSync(sqlFile, sql);
  try {
    wrangler(env, ["execute", "--file", sqlFile]);
  } finally {
    rmSync(sqlFile, { force: true });
  }
}

function tableRows(
  env: MigrationTestEnv,
  table: string,
): Record<string, unknown>[] {
  return d1Query(env, `SELECT * FROM ${table} ORDER BY id;`);
}

function tableIndexNames(env: MigrationTestEnv, table: string): string[] {
  return d1Query<{ name: string }>(
    env,
    `SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = '${table}' ORDER BY name;`,
  ).map((row) => row.name);
}

function seedLegacyAttachmentFixture(env: MigrationTestEnv): void {
  d1Exec(
    env,
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

INSERT OR IGNORE INTO mail_signature_snapshots (
  id, sender_identity_id, body_text, snapshot_hash, created_at
) VALUES (
  '${SNAPSHOT_ID}', '${SENDER_ID}', '', '${REV_HASH}', '${NOW}'
);

INSERT INTO mail_drafts (
  id, author_user_id, mailbox_id, sender_identity_id, subject, body_text,
  sensitivity, compose_mode, autosave_version, last_saved_at, created_at, updated_at
) VALUES (
  '${DRAFT_ID}', '${USER_ID}', '${MAILBOX_ID}', '${SENDER_ID}', 'Subject', 'Body',
  'normal', 'new', 1, '${NOW}', '${NOW}', '${NOW}'
);

INSERT INTO mail_stored_files (
  id, content_hash, original_filename, mime_type, size_bytes,
  storage_provider, storage_bucket, storage_key, created_by_user_id,
  security_scan_status, security_scanned_at, created_at
) VALUES
  (
    '${DIRECT_FILE_ID}', '${DIRECT_HASH}', 'direct.pdf', 'application/pdf', 100,
    'r2', 'crm-mail-attachments', 'draft/direct.pdf', '${USER_ID}',
    'clean', '${NOW}', '${NOW}'
  ),
  (
    '${SECURE_FILE_ID}', '${SECURE_HASH}', 'secure.zip', 'application/zip', 200,
    'r2', 'crm-mail-attachments', 'draft/secure.zip', '${USER_ID}',
    'unscanned', NULL, '${NOW}'
  ),
  (
    '${REV_FILE_ID}', '${REV_HASH}', 'rev.bin', 'application/octet-stream', 50,
    'r2', 'crm-mail-attachments', 'rev/rev.bin', '${USER_ID}',
    'clean', '${NOW}', '${NOW}'
  );

INSERT INTO mail_draft_attachments (
  id, draft_id, stored_file_id, display_filename, sort_order,
  delivery_mode, secure_expiry_days, created_at, updated_at
) VALUES
  (
    '${DRAFT_DIRECT_ATT_ID}', '${DRAFT_ID}', '${DIRECT_FILE_ID}', 'direct.pdf', 0,
    'direct_attachment', NULL, '${NOW}', '${NOW}'
  ),
  (
    '${DRAFT_SECURE_ATT_ID}', '${DRAFT_ID}', '${SECURE_FILE_ID}', 'secure.zip', 1,
    'secure_file', 7, '${NOW}', '${NOW}'
  );

INSERT INTO mail_outbound_revisions (
  id, revision_chain_id, revision_number, source_draft_id, revision_kind,
  created_by_user_id, created_at, mailbox_id, sender_identity_id,
  from_address, subject, body_text, sensitivity, compose_mode,
  signature_snapshot_id, content_hash, hash_version
) VALUES (
  '${REVISION_ID}', '${REVISION_ID}', 1, '${DRAFT_ID}', 'admin_direct',
  '${USER_ID}', '${NOW}', '${MAILBOX_ID}', '${SENDER_ID}',
  'admin@test.local', 'Subject', 'Body', 'normal', 'new',
  '${SNAPSHOT_ID}', '${REV_HASH}', 1
);

INSERT INTO mail_outbound_revision_attachments (
  id, revision_id, stored_file_id, content_hash, original_filename,
  display_filename, mime_type, size_bytes, sort_order, delivery_mode,
  secure_expiry_days, created_at
) VALUES (
  '${REV_ATT_ID}', '${REVISION_ID}', '${REV_FILE_ID}', '${REV_HASH}', 'rev.bin',
  'rev.bin', 'application/octet-stream', 50, 0, 'direct_attachment', NULL, '${NOW}'
);

INSERT INTO mail_threads (
  id, mailbox_id, subject_normalized, last_message_at, created_at, updated_at
) VALUES (
  '${THREAD_ID}', '${MAILBOX_ID}', 'subject', '${NOW}', '${NOW}', '${NOW}'
);

INSERT INTO mail_messages (
  id, thread_id, mailbox_id, direction, sender_identity_id, from_address,
  subject, preview_text, sensitivity, compose_mode, sent_at, created_at, updated_at
) VALUES (
  '${MESSAGE_ID}', '${THREAD_ID}', '${MAILBOX_ID}', 'outbound', '${SENDER_ID}',
  'admin@test.local', 'Subject', '', 'normal', 'new', '${NOW}', '${NOW}', '${NOW}'
);

INSERT INTO mail_message_attachments (
  id, message_id, stored_file_id, source_revision_attachment_id, content_hash,
  original_filename, display_filename, mime_type, size_bytes, sort_order,
  delivery_mode, secure_expiry_days, created_at
) VALUES
  (
    '${MSG_DIRECT_ATT_ID}', '${MESSAGE_ID}', '${REV_FILE_ID}',
    '${REV_ATT_ID}', '${REV_HASH}', 'rev.bin', 'rev.bin',
    'application/octet-stream', 50, 0, 'direct_attachment', NULL, '${NOW}'
  ),
  (
    '${MSG_SECURE_ATT_ID}', '${MESSAGE_ID}', '${SECURE_FILE_ID}',
    NULL, '${SECURE_HASH}', 'secure.zip', 'secure.zip',
    'application/zip', 200, 1, 'secure_file', 3, '${NOW}'
  );
`.trim(),
  );
}

function assertPragmaChecks(env: MigrationTestEnv): void {
  const fkViolations = d1Query<{ table: string; rowid: number }>(
    env,
    "PRAGMA foreign_key_check;",
  );
  assert.deepEqual(fkViolations, []);

  const integrityOutput = wrangler(
    env,
    [
      "execute",
      "--command",
      "PRAGMA integrity_check;",
      "--json",
    ],
    { allowFailure: true },
  );
  if (integrityOutput.includes("SQLITE_AUTH")) {
    return;
  }
  const integrity = JSON.parse(integrityOutput) as Array<{
    results: Array<{ integrity_check: string }>;
  }>;
  assert.equal(integrity[0]?.results[0]?.integrity_check, "ok");
}

after(() => {
  while (cleanupDirs.length > 0) {
    rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
  }
});

describe("0070 mail large attachment lifecycle migration (D1 integration)", () => {
  it("fresh full migration 0001..0070 applies cleanly", () => {
    const env = createEnv(70);
    const output = applyMigrations(env);
    assert.match(output, /0070_mail_large_attachment_lifecycle\.sql/i);

    const lifecycle = d1Query<{ name: string }>(
      env,
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'mail_large_attachment_lifecycle';",
    );
    assert.equal(lifecycle.length, 1);

    const uploadSessions = d1Query<{ name: string }>(
      env,
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'mail_large_attachment_upload_sessions';",
    );
    assert.equal(uploadSessions.length, 1);

    assertPragmaChecks(env);
  });

  it("upgrade path 0001..0069 preserves legacy attachment rows through rebuild", () => {
    const env = createEnv(69);
    applyMigrations(env);
    seedLegacyAttachmentFixture(env);

    const beforeCounts = Object.fromEntries(
      REBUILT_TABLES.map((table) => [table, tableRows(env, table).length]),
    );
    const beforeIds = Object.fromEntries(
      REBUILT_TABLES.map((table) => [
        table,
        tableRows(env, table).map((row) => String(row.id)),
      ]),
    );
    const beforeIndexes = Object.fromEntries(
      REBUILT_TABLES.map((table) => [table, tableIndexNames(env, table)]),
    );

    cpSync(MIGRATION_0070, join(env.migrationsDir, "0070_mail_large_attachment_lifecycle.sql"));
    d1Exec(env, readFileSync(MIGRATION_0070, "utf8"));

    for (const table of REBUILT_TABLES) {
      const afterRows = tableRows(env, table);
      assert.equal(
        afterRows.length,
        beforeCounts[table],
        `${table} row count parity`,
      );
      assert.deepEqual(
        afterRows.map((row) => String(row.id)).sort(),
        (beforeIds[table] as string[]).sort(),
        `${table} primary key parity`,
      );
    }

    const directDraft = d1Query<{ delivery_mode: string; secure_expiry_days: number | null }>(
      env,
      `SELECT delivery_mode, secure_expiry_days FROM mail_draft_attachments WHERE id = '${DRAFT_DIRECT_ATT_ID}';`,
    );
    assert.equal(directDraft[0]?.delivery_mode, "direct_attachment");
    assert.equal(directDraft[0]?.secure_expiry_days, null);

    const secureDraft = d1Query<{ delivery_mode: string; secure_expiry_days: number }>(
      env,
      `SELECT delivery_mode, secure_expiry_days FROM mail_draft_attachments WHERE id = '${DRAFT_SECURE_ATT_ID}';`,
    );
    assert.equal(secureDraft[0]?.delivery_mode, "secure_file");
    assert.equal(secureDraft[0]?.secure_expiry_days, 7);

    const secureMessage = d1Query<{ delivery_mode: string; secure_expiry_days: number }>(
      env,
      `SELECT delivery_mode, secure_expiry_days FROM mail_message_attachments WHERE id = '${MSG_SECURE_ATT_ID}';`,
    );
    assert.equal(secureMessage[0]?.delivery_mode, "secure_file");
    assert.equal(secureMessage[0]?.secure_expiry_days, 3);

    for (const table of REBUILT_TABLES) {
      const afterIndexes = tableIndexNames(env, table);
      for (const expected of EXPECTED_INDEXES[table]) {
        assert.ok(
          afterIndexes.includes(expected),
          `${table} missing index ${expected}`,
        );
      }
    }

    for (const table of REBUILT_TABLES) {
      const before = beforeIndexes[table] as string[];
      const after = tableIndexNames(env, table);
      for (const indexName of before) {
        assert.ok(after.includes(indexName), `${table} lost index ${indexName}`);
      }
    }

    const draftCheck = d1Query<{ sql: string }>(
      env,
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'mail_draft_attachments';",
    );
    assert.match(
      draftCheck[0]?.sql ?? "",
      /delivery_mode IN \('direct_attachment', 'secure_file', 'large_attachment'\)/,
    );

    assertPragmaChecks(env);
  });

  it("migration SQL is classified as data-preserving rebuild and not idempotent", () => {
    const sql = readFileSync(MIGRATION_0070, "utf8");
    assert.match(sql, /DATA-PRESERVING SCHEMA REBUILD/i);
    assert.match(sql, /INSERT INTO mail_draft_attachments_new/);
    assert.doesNotMatch(sql, /IF NOT EXISTS mail_large_attachment_lifecycle/i);
  });
});
