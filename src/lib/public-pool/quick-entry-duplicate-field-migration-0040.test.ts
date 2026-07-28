import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
// Node's experimental sqlite module; types may be absent from the project TS lib.
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...params: unknown[]) => unknown;
      get: (...params: unknown[]) => unknown;
      all: (...params: unknown[]) => unknown[];
    };
    close: () => void;
  };
};

/**
 * Migration 0040 — expand duplicate_field CHECK to include email.
 * Uses in-memory SQLite only (no production / shared local D1).
 */
describe("Migration 0040 expand quick entry duplicate_field", () => {
  const sql = readFileSync(
    "drizzle/migrations/0040_expand_quick_entry_duplicate_field.sql",
    "utf8",
  );

  it("rebuilds with explicit column list (no SELECT *)", () => {
    assert.match(sql, /CREATE TABLE public_pool_quick_entry_submission_rows_new/);
    assert.match(
      sql,
      /INSERT INTO public_pool_quick_entry_submission_rows_new \(/,
    );
    assert.doesNotMatch(sql, /SELECT \*/i);
    assert.match(sql, /DROP TABLE public_pool_quick_entry_submission_rows/);
    assert.match(
      sql,
      /RENAME TO public_pool_quick_entry_submission_rows/,
    );
  });

  it("only expands duplicate_field CHECK to include email", () => {
    assert.match(
      sql,
      /duplicate_field TEXT CHECK \(\s*duplicate_field IS NULL OR duplicate_field IN \('phone', 'wechatId', 'email'\)\s*\)/,
    );
    assert.doesNotMatch(sql, /ALTER TABLE customers/i);
    assert.doesNotMatch(sql, /identifiers/i);
    assert.match(sql, /ON DELETE CASCADE/);
    assert.match(sql, /idx_ppqe_submission_rows_client_row/);
    assert.match(sql, /idx_ppqe_submission_rows_row_index/);
  });

  it("preserves data, accepts email, rejects unknown, keeps indexes and cascade", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");

    db.exec(`
      CREATE TABLE public_pool_quick_entry_submissions (
        id TEXT PRIMARY KEY NOT NULL,
        actor_user_id TEXT NOT NULL,
        submission_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
        row_count INTEGER NOT NULL,
        created_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        invalid_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        processing_started_at TEXT NOT NULL,
        completed_at TEXT,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE public_pool_quick_entry_submission_rows (
        id TEXT PRIMARY KEY NOT NULL,
        submission_db_id TEXT NOT NULL REFERENCES public_pool_quick_entry_submissions (id) ON DELETE CASCADE,
        client_row_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('invalid', 'duplicate', 'created', 'failed')
        ),
        error_code TEXT,
        duplicate_field TEXT CHECK (
          duplicate_field IS NULL OR duplicate_field IN ('phone', 'wechatId')
        ),
        customer_id TEXT,
        customer_code TEXT,
        customer_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX idx_ppqe_submission_rows_client_row
        ON public_pool_quick_entry_submission_rows (submission_db_id, client_row_id);

      CREATE UNIQUE INDEX idx_ppqe_submission_rows_row_index
        ON public_pool_quick_entry_submission_rows (submission_db_id, row_index);
    `);

    const now = "2026-07-29T00:00:00.000Z";
    db.prepare(
      `INSERT INTO public_pool_quick_entry_submissions (
        id, actor_user_id, submission_id, request_hash, status, row_count,
        created_at, updated_at, processing_started_at, expires_at
      ) VALUES (?, ?, ?, ?, 'completed', 3, ?, ?, ?, ?)`,
    ).run("sub-1", "actor-1", "client-sub-1", "h".repeat(64), now, now, now, now);

    const insertRow = db.prepare(
      `INSERT INTO public_pool_quick_entry_submission_rows (
        id, submission_db_id, client_row_id, row_index, status,
        error_code, duplicate_field, customer_id, customer_code, customer_name,
        created_at, updated_at
      ) VALUES (?, 'sub-1', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    );
    insertRow.run("row-null", "c0", 0, "invalid", "ERR", null, now, now);
    insertRow.run(
      "row-phone",
      "c1",
      1,
      "duplicate",
      "QUICK_ENTRY_DUPLICATE_PHONE",
      "phone",
      now,
      now,
    );
    insertRow.run(
      "row-wechat",
      "c2",
      2,
      "duplicate",
      "QUICK_ENTRY_DUPLICATE_WECHAT",
      "wechatId",
      now,
      now,
    );

    assert.throws(() => {
      insertRow.run(
        "row-email-before",
        "c3",
        3,
        "duplicate",
        "QUICK_ENTRY_DUPLICATE_EMAIL",
        "email",
        now,
        now,
      );
    });

    const beforeCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM public_pool_quick_entry_submission_rows`,
      )
      .get() as { n: number };
    assert.equal(beforeCount.n, 3);

    db.exec(sql);

    const afterCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM public_pool_quick_entry_submission_rows`,
      )
      .get() as { n: number };
    assert.equal(afterCount.n, 3);

    const preserved = db
      .prepare(
        `SELECT duplicate_field FROM public_pool_quick_entry_submission_rows ORDER BY row_index`,
      )
      .all() as Array<{ duplicate_field: string | null }>;
    assert.deepEqual(
      preserved.map((r) => r.duplicate_field),
      [null, "phone", "wechatId"],
    );

    const insertAfter = db.prepare(
      `INSERT INTO public_pool_quick_entry_submission_rows (
        id, submission_db_id, client_row_id, row_index, status,
        error_code, duplicate_field, customer_id, customer_code, customer_name,
        created_at, updated_at
      ) VALUES (?, 'sub-1', ?, ?, 'duplicate', ?, ?, NULL, NULL, NULL, ?, ?)`,
    );
    insertAfter.run("row-null-2", "c3", 3, "ERR", null, now, now);
    insertAfter.run(
      "row-phone-2",
      "c4",
      4,
      "QUICK_ENTRY_DUPLICATE_PHONE",
      "phone",
      now,
      now,
    );
    insertAfter.run(
      "row-wechat-2",
      "c5",
      5,
      "QUICK_ENTRY_DUPLICATE_WECHAT",
      "wechatId",
      now,
      now,
    );
    insertAfter.run(
      "row-email",
      "c6",
      6,
      "QUICK_ENTRY_DUPLICATE_EMAIL",
      "email",
      now,
      now,
    );

    assert.throws(() => {
      insertAfter.run(
        "row-unknown",
        "c7",
        7,
        "QUICK_ENTRY_DUPLICATE_PHONE",
        "whatsapp",
        now,
        now,
      );
    });

    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='public_pool_quick_entry_submission_rows' ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((r) => r.name);
    assert.ok(indexNames.includes("idx_ppqe_submission_rows_client_row"));
    assert.ok(indexNames.includes("idx_ppqe_submission_rows_row_index"));

    const triggers = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='public_pool_quick_entry_submission_rows'`,
      )
      .all();
    assert.equal(triggers.length, 0);

    const fk = db
      .prepare(`PRAGMA foreign_key_list('public_pool_quick_entry_submission_rows')`)
      .all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
    assert.equal(fk.length, 1);
    assert.equal(fk[0]?.table, "public_pool_quick_entry_submissions");
    assert.equal(fk[0]?.from, "submission_db_id");
    assert.equal(fk[0]?.to, "id");
    assert.equal(fk[0]?.on_delete, "CASCADE");

    db.prepare(
      `DELETE FROM public_pool_quick_entry_submissions WHERE id = 'sub-1'`,
    ).run();
    const remaining = db
      .prepare(
        `SELECT COUNT(*) AS n FROM public_pool_quick_entry_submission_rows`,
      )
      .get() as { n: number };
    assert.equal(remaining.n, 0);

    db.close();
  });
});
