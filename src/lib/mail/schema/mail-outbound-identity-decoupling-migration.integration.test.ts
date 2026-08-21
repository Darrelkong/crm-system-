import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const ROOT = process.cwd();
const ALL_MIGRATIONS_DIR = join(ROOT, "drizzle/migrations");
const NOW = "2026-08-21T12:00:00.000Z";
const CONTENT_HASH = "a".repeat(64);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const MAILBOX_ID = "22222222-2222-2222-2222-222222222222";
const SENDER_ID = "33333333-3333-3333-3333-333333333333";
const SNAPSHOT_ID = "44444444-4444-4444-4444-444444444444";
const DRAFT_ID = "55555555-5555-5555-5555-555555555555";
const REVISION_ID = "66666666-6666-6666-6666-666666666666";
const SEND_ID = "77777777-7777-7777-7777-777777777777";
const RFC_ID = "88888888-8888-8888-8888-888888888888";
const ATTEMPT_ID = "99999999-9999-9999-9999-999999999999";
const THREAD_OUT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01";
const MSG_OUT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001";
const THREAD_IN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02";
const MSG_IN_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002";
const MAT_ID = "cccccccc-cccc-cccc-cccc-cccccccccc01";

const INTERNAL_RFC = "<internal-stable@echfronthk.com>";
const WIRE_RFC = "<wire-actual@echfronthk.com>";
const PROVIDER_MSG = "cloudflare-tracking-id-001";

interface MigrationTestEnv {
  persistDir: string;
  migrationsDir: string;
  configPath: string;
}

const cleanupDirs: string[] = [];
let sharedEnv: MigrationTestEnv | undefined;

function migrationNumber(fileName: string): number {
  return Number.parseInt(fileName.slice(0, 4), 10);
}

function copyMigrations(maxMigration?: number): string {
  const migrationsDir = mkdtempSync(join(tmpdir(), "crm-mig-0067-files-"));
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
  const persistDir = mkdtempSync(join(tmpdir(), "crm-mig-0067-persist-"));
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
          database_id: `test-0067-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function d1ExecAllowFailure(env: MigrationTestEnv, sql: string): string {
  const sqlFile = join(
    env.migrationsDir,
    `exec-fail-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`,
  );
  writeFileSync(sqlFile, sql);
  try {
    return wrangler(env, ["execute", "--file", sqlFile], { allowFailure: true });
  } finally {
    rmSync(sqlFile, { force: true });
  }
}

function messageOutId(suffix = ""): string {
  const token = (suffix || "00").padStart(12, "0");
  return `cccccccc-cccc-cccc-cccc-${token}`;
}

function messageInId(suffix = ""): string {
  const token = (suffix || "00").padStart(12, "0");
  return `dddddddd-dddd-dddd-dddd-${token}`;
}

function inboundInternetId(suffix = ""): string {
  return `<inbound-${suffix || "base"}@external.test>`;
}

function wireInternetId(suffix = ""): string {
  return `<wire-actual-${suffix || "base"}@echfronthk.com>`;
}

function threadOutId(suffix = ""): string {
  const token = (suffix || "00").padStart(12, "0");
  return `aaaaaaaa-aaaa-aaaa-aaaa-${token}`;
}

function threadInId(suffix = ""): string {
  const token = (suffix || "00").padStart(12, "0");
  return `bbbbbbbb-bbbb-bbbb-bbbb-${token}`;
}

function internalRfcForSuffix(suffix = ""): string {
  if (!suffix) return INTERNAL_RFC;
  return `<internal-stable-${suffix}@echfronthk.com>`;
}

function suffixId(base: string, suffix = ""): string {
  if (!suffix) return base;
  return `${base.slice(0, -suffix.length)}${suffix}`;
}

function seedBaseGraph(env: MigrationTestEnv, suffix = ""): void {
  const revisionId = suffixId(REVISION_ID, suffix);
  const sendId = suffixId(SEND_ID, suffix);
  const rfcId = suffixId(RFC_ID, suffix);
  const attemptId = suffixId(ATTEMPT_ID, suffix);
  const draftId = suffixId(DRAFT_ID, suffix);
  const snapshotId = suffixId(SNAPSHOT_ID, suffix);
  const msgOutId = messageOutId(suffix);
  const msgInId = messageInId(suffix);
  const threadOutIdValue = threadOutId(suffix);
  const threadInIdValue = threadInId(suffix);
  const internalRfc = internalRfcForSuffix(suffix);

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

INSERT INTO mail_send_operations (
  id, outbound_revision_id, revision_chain_id, content_hash, hash_version,
  revision_kind, authorization_mode, idempotency_key, status,
  orchestration_version, initiated_by_user_id, created_at, completed_at
) VALUES (
  '${sendId}', '${revisionId}', '${revisionId}', '${CONTENT_HASH}', 1,
  'admin_direct', 'admin_direct', 'idem-0067-${suffix || "base"}', 'accepted',
  1, '${USER_ID}', '${NOW}', '${NOW}'
);

INSERT INTO mail_outbound_rfc_identities (
  id, send_operation_id, outbound_revision_id, rfc_message_id, created_at
) VALUES (
  '${rfcId}', '${sendId}', '${revisionId}', '${internalRfc}', '${NOW}'
);

INSERT INTO mail_transport_attempts (
  id, send_operation_id, attempt_number, state, provider,
  provider_request_id, provider_message_id, started_at, completed_at
) VALUES (
  '${attemptId}', '${sendId}', 1, 'accepted', 'fake-local',
  'req-${suffix || "base"}', '${PROVIDER_MSG}', '${NOW}', '${NOW}'
);

INSERT INTO mail_threads (
  id, mailbox_id, subject_normalized, last_message_at, created_at, updated_at
) VALUES
  ('${threadOutIdValue}', '${MAILBOX_ID}', 'subject', '${NOW}', '${NOW}', '${NOW}'),
  ('${threadInIdValue}', '${MAILBOX_ID}', 'subject-in', '${NOW}', '${NOW}', '${NOW}');

INSERT INTO mail_messages (
  id, thread_id, mailbox_id, direction, sender_identity_id, from_address,
  subject, preview_text, sensitivity, internet_message_id, compose_mode,
  sent_at, created_at, updated_at
) VALUES (
  '${msgOutId}', '${threadOutIdValue}', '${MAILBOX_ID}', 'outbound', '${SENDER_ID}',
  'admin@test.local', 'Subject', '', 'normal', NULL, 'new',
  '${NOW}', '${NOW}', '${NOW}'
);

INSERT INTO mail_messages (
  id, thread_id, mailbox_id, direction, from_address, subject, preview_text,
  sensitivity, internet_message_id, received_at, created_at, updated_at
) VALUES (
  '${msgInId}', '${threadInIdValue}', '${MAILBOX_ID}', 'inbound', 'customer@test.local',
  'Reply', '', 'normal', '${inboundInternetId(suffix)}', '${NOW}', '${NOW}', '${NOW}'
);
`.trim(),
  );
}

function insertMaterialization(
  env: MigrationTestEnv,
  input: {
    id?: string;
    mailMessageId: string;
    wireInternetMessageId: string | null;
    sendSuffix?: string;
  },
): void {
  const id = input.id ?? MAT_ID;
  const suffix = input.sendSuffix ?? "";
  const sendId = suffixId(SEND_ID, suffix);
  const revisionId = suffixId(REVISION_ID, suffix);
  const attemptId = suffixId(ATTEMPT_ID, suffix);
  const rfcId = suffixId(RFC_ID, suffix);
  const internalRfc = internalRfcForSuffix(suffix);
  const wire = input.wireInternetMessageId;
  const wireSql = wire === null ? "NULL" : `'${wire}'`;
  d1Exec(
    env,
    `
PRAGMA foreign_keys = ON;
INSERT INTO mail_outbound_message_materializations (
  id, send_operation_id, outbound_revision_id, content_hash, hash_version,
  accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id,
  wire_internet_message_id, mail_message_id, message_direction, materialized_at
) VALUES (
  '${id}', '${sendId}', '${revisionId}', '${CONTENT_HASH}', 1,
  '${attemptId}', '${rfcId}', '${internalRfc}',
  ${wireSql}, '${input.mailMessageId}', 'outbound', '${NOW}'
);
`.trim(),
  );
}

after(() => {
  while (cleanupDirs.length > 0) {
    rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
  }
  sharedEnv = undefined;
});

describe("0067 outbound identity decoupling migration (integration)", () => {
  before(() => {
    sharedEnv = createEnv(67);
    applyMigrations(sharedEnv);
  });

  it("applies through 0067 with foreign_key_check = 0", () => {
    const env = sharedEnv!;
    const fkCheck = d1Query<{ foreign_key_check: number }>(
      env,
      "PRAGMA foreign_key_check;",
    );
    assert.equal(fkCheck.length, 0);
  });

  it("outbound mail_message + NULL wire materialization is valid", () => {
    const env = sharedEnv!;
    seedBaseGraph(env);
    insertMaterialization(env, {
      mailMessageId: messageOutId(""),
      wireInternetMessageId: null,
    });

    const rows = d1Query<{ wire_internet_message_id: string | null }>(
      env,
      `SELECT wire_internet_message_id FROM mail_outbound_message_materializations WHERE id = '${MAT_ID}';`,
    );
    assert.equal(rows[0]?.wire_internet_message_id, null);
  });

  it("outbound mail_message + matching non-null wire is valid", () => {
    const env = sharedEnv!;
    const suffix = "02";
    seedBaseGraph(env, suffix);
    const msgOutId = messageOutId(suffix);
    const wireRfc = wireInternetId(suffix);
    d1Exec(
      env,
      `UPDATE mail_messages SET internet_message_id = '${wireRfc}' WHERE id = '${msgOutId}';`,
    );
    insertMaterialization(env, {
      id: "cccccccc-cccc-cccc-cccc-cccccccccc02",
      mailMessageId: msgOutId,
      wireInternetMessageId: wireRfc,
      sendSuffix: suffix,
    });

    const rows = d1Query<{ rfc_message_id: string; wire_internet_message_id: string }>(
      env,
      `SELECT rfc_message_id, wire_internet_message_id FROM mail_outbound_message_materializations WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccc02';`,
    );
    assert.equal(rows[0]?.rfc_message_id, internalRfcForSuffix(suffix));
    assert.equal(rows[0]?.wire_internet_message_id, wireRfc);
    assert.notEqual(rows[0]?.rfc_message_id, rows[0]?.wire_internet_message_id);
  });

  it("inbound mail_message cannot be materialization parent when wire is NULL", () => {
    const env = sharedEnv!;
    const suffix = "03";
    seedBaseGraph(env, suffix);
    const sendId = suffixId(SEND_ID, suffix);
    const revisionId = suffixId(REVISION_ID, suffix);
    const attemptId = suffixId(ATTEMPT_ID, suffix);
    const rfcId = suffixId(RFC_ID, suffix);
    const msgInId = messageInId(suffix);
    const internalRfc = internalRfcForSuffix(suffix);
    const output = d1ExecAllowFailure(
      env,
      `
PRAGMA foreign_keys = ON;
INSERT INTO mail_outbound_message_materializations (
  id, send_operation_id, outbound_revision_id, content_hash, hash_version,
  accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id,
  wire_internet_message_id, mail_message_id, message_direction, materialized_at
) VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccc03', '${sendId}', '${revisionId}',
  '${CONTENT_HASH}', 1, '${attemptId}', '${rfcId}', '${internalRfc}',
  NULL, '${msgInId}', 'outbound', '${NOW}'
);
`.trim(),
    );
    assert.match(output, /FOREIGN KEY constraint failed/i);
  });

  it("mismatched non-null wire fails wire composite FK", () => {
    const env = sharedEnv!;
    const suffix = "04";
    seedBaseGraph(env, suffix);
    const msgOutId = messageOutId(suffix);
    const sendId = suffixId(SEND_ID, suffix);
    const revisionId = suffixId(REVISION_ID, suffix);
    const attemptId = suffixId(ATTEMPT_ID, suffix);
    const rfcId = suffixId(RFC_ID, suffix);
    const internalRfc = internalRfcForSuffix(suffix);
    const wireRfc = wireInternetId(suffix);
    d1Exec(
      env,
      `UPDATE mail_messages SET internet_message_id = '${wireRfc}' WHERE id = '${msgOutId}';`,
    );
    const output = d1ExecAllowFailure(
      env,
      `
PRAGMA foreign_keys = ON;
INSERT INTO mail_outbound_message_materializations (
  id, send_operation_id, outbound_revision_id, content_hash, hash_version,
  accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id,
  wire_internet_message_id, mail_message_id, message_direction, materialized_at
) VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccc04', '${sendId}', '${revisionId}',
  '${CONTENT_HASH}', 1, '${attemptId}', '${rfcId}', '${internalRfc}',
  '<different-wire@echfronthk.com>', '${msgOutId}', 'outbound', '${NOW}'
);
`.trim(),
    );
    assert.match(output, /FOREIGN KEY constraint failed/i);
  });

  it("legacy migration copy leaves wire_internet_message_id NULL", () => {
    const envPre = createEnv(66);
    applyMigrations(envPre);
    const legacySuffix = "99";
    seedBaseGraph(envPre, legacySuffix);
    const msgOutId = messageOutId(legacySuffix);
    const matId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee99";
    const sendId = suffixId(SEND_ID, legacySuffix);
    const revisionId = suffixId(REVISION_ID, legacySuffix);
    const attemptId = suffixId(ATTEMPT_ID, legacySuffix);
    const rfcId = suffixId(RFC_ID, legacySuffix);
    const internalRfc = internalRfcForSuffix(legacySuffix);

    d1Exec(
      envPre,
      `
PRAGMA foreign_keys = ON;
UPDATE mail_messages SET internet_message_id = '${internalRfc}' WHERE id = '${msgOutId}';
INSERT INTO mail_outbound_message_materializations (
  id, send_operation_id, outbound_revision_id, content_hash, hash_version,
  accepted_transport_attempt_id, outbound_rfc_identity_id, rfc_message_id,
  mail_message_id, message_direction, materialized_at
) VALUES (
  '${matId}', '${sendId}', '${revisionId}', '${CONTENT_HASH}', 1,
  '${attemptId}', '${rfcId}', '${internalRfc}',
  '${msgOutId}', 'outbound', '${NOW}'
);
`.trim(),
    );

    cpSync(
      join(ALL_MIGRATIONS_DIR, "0067_mail_outbound_identity_decoupling.sql"),
      join(envPre.migrationsDir, "0067_mail_outbound_identity_decoupling.sql"),
    );
    applyMigrations(envPre);

    const rows = d1Query<{
      wire_internet_message_id: string | null;
      rfc_message_id: string;
    }>(
      envPre,
      `SELECT wire_internet_message_id, rfc_message_id FROM mail_outbound_message_materializations WHERE id = '${matId}';`,
    );
    assert.equal(rows[0]?.wire_internet_message_id, null);
    assert.equal(rows[0]?.rfc_message_id, internalRfc);

    const message = d1Query<{ internet_message_id: string | null }>(
      envPre,
      `SELECT internet_message_id FROM mail_messages WHERE id = '${msgOutId}';`,
    );
    assert.equal(message[0]?.internet_message_id, internalRfc);
  });
});
