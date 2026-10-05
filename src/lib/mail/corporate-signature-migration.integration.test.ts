import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "node:test";
import { getPlatformProxy } from "wrangler";
import { CORPORATE_SIGNATURE_V1 as V1 } from "./corporate-signature-domain";

const root = process.cwd();
const migration = "0093_mail_corporate_signature_domain.sql";
const source = join(root, "drizzle/migrations");
const now = "2026-10-05T00:00:00.000Z";
type D1Database = CloudflareEnv["DB"];
type D1PreparedStatement = ReturnType<D1Database["prepare"]>;

function createEnvironment() {
  const directory = mkdtempSync(join(tmpdir(), "crm-m2a-migration-"));
  const migrations = join(directory, "migrations");
  mkdirSync(migrations);
  const config = join(directory, "wrangler.json");
  const persist = join(directory, "state");
  // No app config, R2, network bindings, credentials, services or remote D1 IDs.
  writeFileSync(config, JSON.stringify({ name: "m2a-local-only", compatibility_date: "2026-10-01",
    d1_databases: [{ binding: "DB", database_name: "m2a-local-only", database_id: "m2a-disposable", migrations_dir: migrations }] }));
  for (const name of readdirSync(source).filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < migration).sort()) {
    copyFileSync(join(source, name), join(migrations, name));
  }
  const apply = () => execFileSync(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"),
    "d1", "migrations", "apply", "m2a-local-only", "--local", "--persist-to", persist, "--config", config],
  { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, maxBuffer: 100 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", WRANGLER_SEND_METRICS: "false", CI: "1" } });
  return { directory, migrations, apply,
    connect: () => getPlatformProxy<{ DB: D1Database }>({ configPath: config, persist: { path: join(persist, "v3") } }),
    addM2A: () => copyFileSync(join(source, migration), join(migrations, migration)) };
}

async function integrity(db: D1Database) {
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  assert.equal((await db.prepare("PRAGMA quick_check").first())?.quick_check, "ok");
}

function closedDatabaseIntegrity(directory: string) {
  // D1 exposes quick_check, not integrity_check. Inspect only this disposable
  // local database, read-only, after the Miniflare handle has been disposed.
  const output = execFileSync("python3", ["-c", "import sqlite3,pathlib,json,sys; result=[]\nfor p in pathlib.Path(sys.argv[1]).rglob('*.sqlite'):\n c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)\n if c.execute(\"SELECT 1 FROM sqlite_master WHERE name='mail_corporate_signature_template_versions'\").fetchone(): result.append(c.execute('PRAGMA integrity_check').fetchall())\n c.close()\nprint(json.dumps(result))", directory], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), [[["ok"]]]);
}

async function seedLegacy(db: D1Database) {
  const statements = [
    "INSERT INTO users (id,email,display_name,password_hash,role,is_active,created_at,updated_at) VALUES ('m2a-user','synthetic@example.invalid','Synthetic','not-a-login-hash','admin',1,?,?)",
    "INSERT INTO mail_mailboxes (id,address,display_name,mailbox_type,created_at,updated_at) VALUES ('m2a-mailbox','box@example.invalid','Synthetic','shared',?,?)",
    "INSERT INTO mail_sender_identities (id,address,display_name,default_mailbox_id,created_at,updated_at) VALUES ('m2a-sender','sender@example.invalid','Synthetic','m2a-mailbox',?,?)",
  ];
  for (const sql of statements) await db.prepare(sql).bind(now, now).run();
  await db.prepare("INSERT INTO mail_signature_versions (id,sender_identity_id,version_number,body_text,body_html_sanitized,is_active,created_at) VALUES ('m2a-legacy','m2a-sender',1,'Legacy signature','<p>Legacy signature</p>',1,?)").bind(now).run();
  await db.prepare("INSERT INTO mail_signature_snapshots (id,sender_identity_id,source_signature_version_id,body_text,body_html_sanitized,snapshot_hash,created_at) VALUES ('m2a-snapshot','m2a-sender','m2a-legacy','Legacy signature','<p>Legacy signature</p>','unchanged-snapshot-hash',?)").bind(now).run();
  await db.prepare("INSERT INTO mail_outbound_revisions (id,revision_chain_id,revision_number,revision_kind,created_by_user_id,created_at,mailbox_id,sender_identity_id,from_address,subject,compose_mode,signature_snapshot_id,content_hash,hash_version) VALUES ('m2a-revision','m2a-chain',1,'admin_direct','m2a-user',?,'m2a-mailbox','m2a-sender','sender@example.invalid','Synthetic only','new','m2a-snapshot','unchanged-revision-hash',1)").bind(now).run();
  await db.prepare("INSERT INTO mail_stored_files (id,content_hash,original_filename,mime_type,size_bytes,storage_provider,storage_bucket,storage_key,created_at) VALUES ('m2a-file','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','synthetic.png','image/png',8,'r2','local-only','synthetic',?)").bind(now).run();
  await db.prepare("INSERT INTO mail_signature_version_assets (id,signature_version_id,stored_file_id,content_hash,asset_ref,mime_type,size_bytes,created_at) VALUES ('m2a-version-asset','m2a-legacy','m2a-file','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','logo','image/png',8,?)").bind(now).run();
  await db.prepare("INSERT INTO mail_signature_snapshot_assets (id,signature_snapshot_id,stored_file_id,content_hash,asset_ref,mime_type,size_bytes,created_at) VALUES ('m2a-snapshot-asset','m2a-snapshot','m2a-file','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','logo','image/png',8,?)").bind(now).run();
}

async function captureLegacy(db: D1Database) {
  const tables = ["mail_sender_identities", "mail_signature_versions", "mail_signature_snapshots", "mail_outbound_revisions",
    "mail_signature_version_assets", "mail_signature_snapshot_assets"];
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables) result[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
  return result;
}

async function insertTemplate(db: D1Database, id: string, number: number, active = 0) {
  return db.prepare(`INSERT INTO mail_corporate_signature_template_versions
    (id,version_number,rendering_contract_version,brand_label,service_line_1,service_line_2,website,tagline,
    confidentiality_heading,confidentiality_paragraph_1,confidentiality_paragraph_2,legal_entity_line,is_active,created_at,activated_at)
    VALUES (?,?, 'echfront-corporate-v1', ?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, number, V1.brandLabel, V1.serviceLine1, V1.serviceLine2, V1.website, V1.tagline,
      V1.confidentialityHeading, V1.confidentialityParagraph1, V1.confidentialityParagraph2, V1.legalEntityLine,
      active, now, active ? now : null).run();
}

it("fresh canonical chain through M2A applies in disposable local D1", { timeout: 180_000 }, async () => {
  const env = createEnvironment();
  env.addM2A();
  env.apply();
  const proxy = await env.connect();
  try {
    const db = proxy.env.DB;
    await integrity(db);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM d1_migrations").first())?.n, 93);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM mail_corporate_signature_template_versions").first())?.n, 0);
  } finally { await proxy.dispose(); }
  closedDatabaseIntegrity(env.directory);
});

it("populated 0092 upgrade preserves legacy rows and enforces additive contracts", { timeout: 180_000 }, async (t) => {
  const env = createEnvironment();
  env.apply();
  let proxy = await env.connect();
  let old: Awaited<ReturnType<typeof captureLegacy>>;
  try {
    assert.equal((await proxy.env.DB.prepare("SELECT count(*) AS n FROM d1_migrations").first())?.n, 92);
    await seedLegacy(proxy.env.DB);
    await integrity(proxy.env.DB);
    old = await captureLegacy(proxy.env.DB);
  } finally { await proxy.dispose(); }
  env.addM2A();
  env.apply();
  proxy = await env.connect();
  const db = proxy.env.DB;
  try {
    await t.test("old fields, hashes, FK lineage and assets remain byte-for-byte unchanged", async () => {
      const current = await captureLegacy(db);
      for (const [table, rows] of Object.entries(old)) {
        assert.equal(current[table].length, rows.length);
        rows.forEach((row, i) => assert.deepEqual(Object.fromEntries(Object.keys(row).map((key) => [key, current[table][i][key]])), row));
      }
      await integrity(db);
    });
    await t.test("historical profile and snapshot additions are unconfigured/null", async () => {
      assert.deepEqual(await db.prepare("SELECT signature_identity_type,signature_job_title,signature_phone,signature_profile_revision FROM mail_sender_identities WHERE id='m2a-sender'").first(),
        { signature_identity_type: null, signature_job_title: null, signature_phone: null, signature_profile_revision: 0 });
      assert.deepEqual(await db.prepare("SELECT source_corporate_template_version_id,source_signature_profile_revision FROM mail_signature_snapshots WHERE id='m2a-snapshot'").first(),
        { source_corporate_template_version_id: null, source_signature_profile_revision: null });
    });
    await t.test("version number and single active corporate lineage are unique", async () => {
      await insertTemplate(db, "v1", 1, 1);
      await assert.rejects(insertTemplate(db, "duplicate", 1));
      await assert.rejects(insertTemplate(db, "active2", 2, 1));
      await insertTemplate(db, "v2", 2);
    });
    await t.test("template publication retains immutable historical content", async () => {
      await db.batch([
        db.prepare("UPDATE mail_corporate_signature_template_versions SET is_active=0,retired_at=? WHERE id='v1'").bind(now),
        db.prepare("UPDATE mail_corporate_signature_template_versions SET is_active=1,activated_at=? WHERE id='v2'").bind(now),
      ]);
      assert.equal((await db.prepare("SELECT brand_label FROM mail_corporate_signature_template_versions WHERE id='v1'").first())?.brand_label, "ECHFRONT");
      await assert.rejects(db.prepare("UPDATE mail_corporate_signature_template_versions SET tagline='rewrite' WHERE id='v1'").run());
      await assert.rejects(db.prepare("DELETE FROM mail_corporate_signature_template_versions WHERE id='v1'").run());
      await assert.rejects(db.prepare("UPDATE mail_corporate_signature_template_versions SET is_active=1 WHERE id='v1'").run());
    });
    await t.test("profile enum and revision guards reject invalid state", async () => {
      await assert.rejects(db.prepare("UPDATE mail_sender_identities SET signature_identity_type='shared' WHERE id='m2a-sender'").run());
      await assert.rejects(db.prepare("UPDATE mail_sender_identities SET signature_profile_revision=0.5 WHERE id='m2a-sender'").run());
      await db.prepare("UPDATE mail_sender_identities SET signature_identity_type='corporate',signature_profile_revision=7 WHERE id='m2a-sender'").run();
      await assert.rejects(db.prepare("UPDATE mail_sender_identities SET signature_profile_revision=6 WHERE id='m2a-sender'").run());
    });
    const snapshot = (id: string, legacy: string | null, corporate: string | null, revision: number | null) => db.prepare(`INSERT INTO mail_signature_snapshots
      (id,sender_identity_id,source_signature_version_id,source_corporate_template_version_id,source_signature_profile_revision,snapshot_hash,created_at)
      VALUES (?,'m2a-sender',?,?,?,'synthetic',?)`).bind(id, legacy, corporate, revision, now).run();
    await t.test("corporate provenance and legacy source remain separately valid", async () => {
      await snapshot("corporate", null, "v1", 7);
      await snapshot("legacy-again", "m2a-legacy", null, null);
      await snapshot("legacy-empty", null, null, null);
    });
    await t.test("corporate FK, mixed provenance and incomplete profile provenance fail closed", async () => {
      for (const [legacy, corporate, revision] of [[null, "missing", 1], ["m2a-legacy", "v1", 1],
        [null, "v1", null], [null, null, 1], [null, "v1", 0]] as const) {
        await assert.rejects(snapshot("invalid", legacy, corporate, revision));
      }
      // UPDATE must enforce the same exclusivity; not merely INSERT.
      await assert.rejects(db.prepare("UPDATE mail_signature_snapshots SET source_signature_version_id='m2a-legacy' WHERE id='corporate'").run());
    });
    await t.test("legacy composite FK and outbound dedicated snapshot lineage still enforce identity", async () => {
      await db.prepare("INSERT INTO mail_sender_identities (id,address,default_mailbox_id,created_at,updated_at) VALUES ('other','other@example.invalid','m2a-mailbox',?,?)").bind(now, now).run();
      await assert.rejects(db.prepare("UPDATE mail_signature_snapshots SET sender_identity_id='other' WHERE id='legacy-again'").run());
      await assert.rejects(db.prepare("UPDATE mail_outbound_revisions SET sender_identity_id='other' WHERE id='m2a-revision'").run());
      await integrity(db);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM d1_migrations").first())?.n, 93);
    });
  } finally { await proxy.dispose(); }
  closedDatabaseIntegrity(env.directory);
});

for (const recursiveTriggers of [0, 1]) {
  it(`corporate history cannot be replaced with recursive_triggers=${recursiveTriggers}`, { timeout: 180_000 }, async (t) => {
    const env = createEnvironment();
    env.addM2A();
    env.apply();
    const proxy = await env.connect();
    const db = proxy.env.DB;
    const table = "mail_corporate_signature_template_versions";
    try {
      await seedLegacy(db);
      await insertTemplate(db, "v1", 1, 1);
      await db.prepare(`UPDATE ${table} SET created_by_user_id='m2a-user' WHERE id='v1'`).run();
      await db.prepare(`INSERT INTO mail_signature_snapshots
        (id,sender_identity_id,source_corporate_template_version_id,source_signature_profile_revision,
         body_text,body_html_sanitized,snapshot_hash,created_at)
        VALUES ('replacement-snapshot','m2a-sender','v1',7,'Frozen synthetic body',
          '<p>Frozen synthetic body</p>','frozen-synthetic-hash',?)`).bind(now).run();

      const modeSql = `PRAGMA recursive_triggers=${recursiveTriggers}`;
      // Verify the requested mode inside the same batch. Every attempted write
      // also predicates its source/target on this PRAGMA: a mode mismatch would
      // write nothing and fail the expected-trigger-rejection assertion.
      const modePredicate = `(SELECT recursive_triggers FROM pragma_recursive_triggers)=${recursiveTriggers}`;
      const modeResult = await db.batch([db.prepare(modeSql), db.prepare("PRAGMA recursive_triggers")]);
      assert.deepEqual(modeResult[1].results, [{ recursive_triggers: recursiveTriggers }]);
      const run = (statement: D1PreparedStatement) => db.batch([db.prepare(modeSql), statement]);
      const columns: string[] = (await db.prepare(`PRAGMA table_info(${table})`).all()).results
        .map((row: { name: string }) => row.name);
      const copyInsert = (verb: string, overrides: Record<string, string | number | null>, suffix = "") => {
        const values: (string | number | null)[] = [];
        const selection = columns.map((column) => {
          if (!Object.hasOwn(overrides, column)) return `"${column}"`;
          values.push(overrides[column]);
          return "?";
        });
        return db.prepare(`${verb} INTO ${table} (${columns.map((column) => `"${column}"`).join(",")})
          SELECT ${selection.join(",")} FROM ${table} WHERE id='v1' AND ${modePredicate} ${suffix}`).bind(...values);
      };
      const capture = async (): Promise<{
        templates: Record<string, unknown>[];
        snapshots: Record<string, unknown>[];
        target: Record<string, unknown> | null;
      }> => ({
        templates: (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results,
        snapshots: (await db.prepare("SELECT * FROM mail_signature_snapshots ORDER BY id").all()).results,
        target: await db.prepare(`SELECT t.* FROM ${table} t JOIN mail_signature_snapshots s
          ON s.source_corporate_template_version_id=t.id WHERE s.id='replacement-snapshot'`).first(),
      });
      const rejectAndPreserve = async (statement: D1PreparedStatement, reason: RegExp) => {
        const before = await capture();
        assert.ok(before.target, "corporate snapshot must resolve before attempted replacement");
        await assert.rejects(run(statement), reason);
        const after = await capture();
        assert.deepEqual(after, before, "every template field, row count and snapshot must remain unchanged");
        assert.equal(after.templates.length, before.templates.length);
        assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
      };
      const replacementError = /Corporate signature template replacement is forbidden/;

      await t.test("INSERT OR REPLACE same ID preserves full history and corporate snapshot target", async () => {
        await rejectAndPreserve(copyInsert("INSERT OR REPLACE", { tagline: "Changed content" }), replacementError);
      });
      await t.test("different ID with same lineage/version cannot replace history", async () => {
        await rejectAndPreserve(copyInsert("INSERT OR REPLACE", {
          id: "other-id", tagline: "Changed content", is_active: 0,
        }), replacementError);
      });
      await t.test("different ID/version cannot evict the active template", async () => {
        await rejectAndPreserve(copyInsert("INSERT OR REPLACE", {
          id: "new-active", version_number: 2, tagline: "Changed content",
        }), replacementError);
      });
      await t.test("REPLACE INTO alias cannot replace a durable ID", async () => {
        await rejectAndPreserve(copyInsert("REPLACE", { tagline: "Changed content" }), replacementError);
      });
      for (const verb of ["INSERT", "INSERT OR IGNORE", "INSERT OR ABORT", "INSERT OR FAIL", "INSERT OR ROLLBACK"]) {
        await t.test(`${verb} conflict cannot suppress the history guard`, async () => {
          await rejectAndPreserve(copyInsert(verb, { tagline: "Changed content" }), replacementError);
        });
      }
      for (const suffix of ["ON CONFLICT(id) DO NOTHING", "ON CONFLICT(id) DO UPDATE SET tagline=excluded.tagline"]) {
        await t.test(`${suffix} cannot bypass the insert guard`, async () => {
          await rejectAndPreserve(copyInsert("INSERT", { tagline: "Changed content" }, suffix), replacementError);
        });
      }
      await t.test("normal non-conflicting V2 insert retains V1 and its snapshot", async () => {
        const before = await capture();
        await run(copyInsert("INSERT", { id: "v2", version_number: 2, is_active: 0, activated_at: null }));
        const after = await capture();
        assert.equal(after.templates.length, before.templates.length + 1);
        assert.deepEqual(after.templates.find((row) => row.id === "v1"), before.target);
        assert.deepEqual(after.target, before.target);
        assert.deepEqual(after.snapshots, before.snapshots);
      });
      await t.test("UPDATE OR REPLACE activation cannot evict the currently active V1", async () => {
        await rejectAndPreserve(db.prepare(`UPDATE OR REPLACE ${table} SET is_active=1,activated_at=?
          WHERE id='v2' AND ${modePredicate}`).bind(now), /Corporate signature active template replacement is forbidden/);
      });
      await t.test("valid retirement and activation preserve content and snapshot provenance", async () => {
        const before = await capture();
        await db.batch([
          db.prepare(modeSql),
          db.prepare(`UPDATE ${table} SET is_active=0,retired_at=?,retired_by_user_id='m2a-user' WHERE id='v1' AND ${modePredicate}`).bind(now),
          db.prepare(`UPDATE ${table} SET is_active=1,activated_at=? WHERE id='v2' AND ${modePredicate}`).bind(now),
        ]);
        const after = await capture();
        assert.deepEqual(after.target, { ...before.target, is_active: 0, retired_at: now, retired_by_user_id: "m2a-user" });
        assert.deepEqual(after.snapshots, before.snapshots);
        assert.deepEqual(after.templates.find((row) => row.id === "v2"), {
          ...before.templates.find((row) => row.id === "v2"), is_active: 1, activated_at: now,
        });
      });
      await t.test("retired historical V1 still rejects replacement", async () => {
        await rejectAndPreserve(copyInsert("INSERT OR REPLACE", { tagline: "Changed retired content" }), replacementError);
      });
      await t.test("canonical UPDATE remains forbidden with full row preservation", async () => {
        await rejectAndPreserve(db.prepare(`UPDATE ${table} SET tagline='Changed content' WHERE id='v1' AND ${modePredicate}`),
          /Corporate signature template content is immutable/);
      });
      await t.test("DELETE remains forbidden with full row preservation", async () => {
        await rejectAndPreserve(db.prepare(`DELETE FROM ${table} WHERE id='v1' AND ${modePredicate}`),
          /Corporate signature template history must be retained/);
      });
      await integrity(db);
    } finally { await proxy.dispose(); }
    closedDatabaseIntegrity(env.directory);
  });
}
