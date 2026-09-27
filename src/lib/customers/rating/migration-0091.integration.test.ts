import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const ROOT = process.cwd();
const TEMP = mkdtempSync(join(tmpdir(), "crm-f4b-0091-"));
const SI2 = "b66bb9e0ad90c948a773c914ca18811bac1e83e8";
const MIG = "0091_human_customer_rating.sql";
const cli = join(ROOT, "node_modules/wrangler/wrangler-dist/cli.js");
type Env = { dir: string; config: string; migrations: string };
type Row = Record<string, unknown>;
after(() => rmSync(TEMP, { recursive: true, force: true }));
function env(path: string): Env {
  const dir = join(TEMP, path), migrations = join(dir, "migrations"), config = join(dir, "wrangler.json");
  mkdirSync(migrations, { recursive: true });
  writeFileSync(config, JSON.stringify({ name: "f4b-local-only", compatibility_date: "2026-09-01",
    d1_databases: [{ binding: "DB", database_name: "f4b-local-only", database_id: "00000000-0000-4000-8000-000000000091", migrations_dir: migrations }] }));
  for (const f of readdirSync(join(ROOT, "drizzle/migrations"))) if (/^\d{4}.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 86) {
    copyFileSync(join(ROOT, "drizzle/migrations", f), join(migrations, f));
  }
  return { dir, config, migrations };
}
function run(e: Env, args: string[]): string {
  try {
    return execFileSync(process.execPath, [cli, "d1", ...args, "f4b-local-only", "--local", "--persist-to", join(e.dir, "state"), "--config", e.config], {
    cwd: e.dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 120000,
    maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
    });
  } catch (error) {
    // Wrangler --json reports SQL constraint failures on stdout, not Error.message.
    if (typeof error === "object" && error !== null && "stdout" in error && typeof error.stdout === "string") {
      let failure: { error?: { text?: string } } | undefined;
      try { failure = JSON.parse(error.stdout); } catch { /* Preserve the original CLI failure. */ }
      if (failure?.error?.text) throw new Error(failure.error.text);
    }
    throw error;
  }
}
function query(e: Env, sql: string): Row[] {
  const result = JSON.parse(run(e, ["execute", "--command", sql, "--json"])) as { results: Row[] }[];
  return result[0].results;
}
function apply(e: Env) { run(e, ["migrations", "apply"]); }
function add(e: Env, filename: string) {
  const text = filename === MIG ? readFileSync(join(ROOT, "drizzle/migrations", filename), "utf8")
    : execFileSync("git", ["show", `${SI2}:drizzle/migrations/${filename}`], { cwd: ROOT, encoding: "utf8" });
  writeFileSync(join(e.migrations, filename), text);
  apply(e);
  assert.deepEqual(query(e, "PRAGMA foreign_key_check"), []);
  assert.deepEqual(query(e, "PRAGMA quick_check"), [{ quick_check: "ok" }]);
}
function seed(e: Env) {
  query(e, `INSERT INTO users(id,email,display_name,password_hash,role,created_at,updated_at)
    VALUES('u','synthetic@example.test','Synthetic actor','not-a-credential','admin','2026-01-01','2026-01-01');
    INSERT INTO customers(id,customer_name,source,owner_id,created_by,created_at,updated_at,sales_stage,status)
    VALUES('c1','Synthetic A','other','u','u','2026-01-01','2026-01-01','contacted','active'),
    ('c2','Synthetic B','other','u','u','2026-01-01','2026-01-01','new_lead','public_pool');
    INSERT INTO follow_ups(id,customer_id,user_id,follow_up_time,channel,outcome,summary,customer_intent,content,follow_up_type,created_at)
    VALUES('f1','c1','u','2026-01-02','phone','interested','Synthetic summary','Legacy intent remains','Legacy content','phone','2026-01-02'),
    ('f2','c2','u','2026-01-02','phone','no_reply','Synthetic older row',NULL,'Older legacy content','phone','2026-01-02');
    INSERT INTO customer_ai_insights(id,customer_id,intent_level,intent_score,customer_summary,current_situation,
      key_signals_json,risk_flags_json,missing_information_json,next_best_action,suggested_employee_message,
      confidence,reasoning,model,prompt_version,source_hash,status,generated_at,created_at,updated_at)
    VALUES('ai1','c1','high',99,'Synthetic AI','Synthetic situation','[]','[]','[]','Synthetic action','Synthetic message',
      0.9,'Synthetic reasoning','fixture','fixture','fixture','ready','2026-01-01','2026-01-01','2026-01-01');`);
}
function snapshot(e: Env) {
  const customers = query(e, "SELECT * FROM customers ORDER BY id").map(({ customer_rating: _r, customer_rating_revision: _v, ...r }) => { void _r; void _v; return r; });
  return { customers, followUps: query(e, "SELECT * FROM follow_ups ORDER BY id"), ai: query(e, "SELECT * FROM customer_ai_insights ORDER BY id") };
}
const siFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", SI2, "drizzle/migrations"], { cwd: ROOT, encoding: "utf8" })
  .trim().split("\n").map((f) => f.split("/").at(-1)!).filter((f) => /^00(87|88|89|90)_/.test(f)).sort();
const states = new Map<string, Env>();
for (const path of ["A", "B", "C"]) it(`populated 0086 upgrade path ${path}: preservation, every migration FK/quick_check, no backfill`, () => {
  assert.equal(siFiles.length, 4);
  const e = env(path); apply(e); seed(e);
  const before = snapshot(e);
  assert.equal(before.customers.length, 2); assert.equal(before.followUps.length, 2); assert.equal(before.ai.length, 1);
  assert.equal(query(e, "SELECT name FROM d1_migrations").length, 86);
  assert.equal(query(e, "PRAGMA table_info(customers)").some((r) => r.name === "customer_rating"), false);
  const sequence = path === "A" ? [MIG] : path === "B" ? [...siFiles, MIG] : [MIG, ...siFiles];
  for (const filename of sequence) {
    add(e, filename);
    assert.deepEqual(snapshot(e), before, `legacy data after ${filename}`);
    if (query(e, "PRAGMA table_info(customers)").some((r) => r.name === "customer_rating")) {
      assert.deepEqual(query(e, "SELECT customer_rating, customer_rating_revision FROM customers ORDER BY id"), [
        { customer_rating: null, customer_rating_revision: 0 }, { customer_rating: null, customer_rating_revision: 0 },
      ]);
      assert.deepEqual(query(e, "SELECT * FROM customer_rating_history"), []);
    }
  }
  const applied = query(e, "SELECT name FROM d1_migrations ORDER BY id").map((r) => r.name);
  assert.deepEqual(applied.slice(86), sequence);
  assert.equal(new Set(applied).size, applied.length);
  const indexes = query(e, "SELECT name FROM sqlite_master WHERE type='index'").map((r) => r.name);
  assert.ok(indexes.includes("uq_customer_rating_history_follow_up"));
  assert.ok(indexes.includes("idx_customer_rating_history_customer_recorded"));
  states.set(path, e);
});
it("B and C have equivalent complete application schema and all SI2 objects", () => {
  const sql = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
  const b = query(states.get("B")!, sql), c = query(states.get("C")!, sql);
  assert.deepEqual(b, c);
  for (const name of ["knowledge_business_category_mappings", "knowledge_source_segment_candidates", "uq_knowledge_ai_runs_active_candidate", "uq_knowledge_ai_comparison_runs_active_candidate", "idx_knowledge_source_segment_candidates_draft_article"]) {
    assert.ok(b.some((r) => r.name === name), name);
  }
  for (const table of ["knowledge_ai_comparison_runs", "knowledge_ai_organization_runs"]) assert.ok(query(states.get("B")!, `PRAGMA table_info(${table})`).some((r) => r.name === "candidate_id"));
});
function insert(overrides: Record<string, string> = {}) {
  const fields: Record<string, string> = { id: "'h'", customer_id: "'c1'", follow_up_id: "'f1'", actor_user_id: "'u'", rating_before: "NULL", rating_after: "'A'", action: "'follow_up_confirmed'", revision_before: "0", revision_after: "1", reason: "NULL", recorded_at: "'2026-09-27'", ...overrides };
  return `INSERT INTO customer_rating_history(${Object.keys(fields).join(',')}) VALUES(${Object.values(fields).join(',')})`;
}
it("customer rating values/revisions and history CHECK/FK constraints reject invalid writes", () => {
  const e = states.get("A")!;
  for (const sql of ["UPDATE customers SET customer_rating='C'", "UPDATE customers SET customer_rating='high'", "UPDATE customers SET customer_rating_revision=-1", "UPDATE customers SET customer_rating_revision=0.5", "UPDATE customers SET customer_rating_revision=NULL"]) {
    assert.throws(() => query(e, sql), /CHECK constraint|NOT NULL constraint/);
  }
  const invalidValues: Record<string, string>[] = [{ rating_before: "'C'" }, { rating_after: "'C'" }, { action: "'ai_assigned'" }, { action: "'preserved_no_contact'" }, { revision_before: "-1", revision_after: "0" }, { revision_after: "2" }, { revision_before: "0.5", revision_after: "1.5" }, { rating_after: "NULL" }, { customer_id: "'missing'" }, { follow_up_id: "'missing'" }, { actor_user_id: "'missing'" }, { action: "'manual_clear'", follow_up_id: "NULL", rating_before: "'A'", rating_after: "NULL", reason: "'four'" }, { action: "'manual_correction'", follow_up_id: "NULL", reason: "NULL" }];
  for (const values of invalidValues) {
    assert.throws(() => query(e, insert(values)), /CHECK constraint|FOREIGN KEY constraint/);
  }
  assert.deepEqual(query(e, "SELECT * FROM customer_rating_history"), []);
});
it("history supports same-rating confirmation, manual correction/clear; one event per non-null follow-up", () => {
  const e = states.get("A")!;
  query(e, insert({ rating_before: "'A'" }));
  assert.throws(() => query(e, insert({ id: "'duplicate'" })), /UNIQUE constraint/);
  for (const [i, r] of ["S", "A", "B", "D"].entries()) {
    query(e, insert({ id: `'manual${i}'`, follow_up_id: "NULL", action: "'manual_correction'", rating_after: `'${r}'`, reason: "'human reason'", revision_before: String(i + 1), revision_after: String(i + 2) }));
    query(e, `UPDATE customers SET customer_rating='${r}',customer_rating_revision=${i + 1} WHERE id='c1'`);
  }
  query(e, insert({ id: "'clear'", follow_up_id: "NULL", action: "'manual_clear'", rating_before: "'D'", rating_after: "NULL", reason: "'human clear reason'", revision_before: "5", revision_after: "6" }));
  assert.equal(query(e, "SELECT * FROM customer_rating_history").length, 6);
});
it("follow-up deletion preserves human history; customer hard-purge cascades without blocking or orphans", () => {
  const e = states.get("A")!;
  query(e, "DELETE FROM follow_ups WHERE id='f1'");
  assert.equal(query(e, "SELECT follow_up_id FROM customer_rating_history WHERE id='h'")[0].follow_up_id, null);
  assert.equal(query(e, "SELECT * FROM customer_rating_history").length, 6);
  query(e, "DELETE FROM customers WHERE id='c1'");
  assert.deepEqual(query(e, "SELECT * FROM customer_rating_history"), []);
  assert.deepEqual(query(e, "PRAGMA foreign_key_check"), []);
  assert.deepEqual(query(e, "PRAGMA quick_check"), [{ quick_check: "ok" }]);
});
