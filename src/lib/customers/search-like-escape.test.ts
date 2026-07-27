import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { schema } from "@/lib/db";
import {
  CUSTOMER_SEARCH_LIKE_ESCAPE,
  buildSearchWhere,
  escapeLikePattern,
  escapedLike,
} from "@/lib/customers/queries";

function collectSqlParts(node: unknown, out: unknown[] = []): unknown[] {
  if (node == null) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(node);
    return out;
  }
  if (typeof node !== "object") return out;
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.queryChunks)) {
    for (const chunk of record.queryChunks) {
      collectSqlParts(chunk, out);
    }
    return out;
  }
  if (Array.isArray(record.value)) {
    for (const part of record.value) {
      if (typeof part === "string") out.push(part);
    }
  }
  if ("value" in record && typeof record.value === "string") {
    out.push(record.value);
  }
  if ("name" in record && typeof record.name === "string") {
    out.push(`col:${record.name}`);
  }
  return out;
}

function sqlText(node: unknown): string {
  return collectSqlParts(node)
    .map(String)
    .join(" ");
}

describe("escapeLikePattern", () => {
  it("escapes backslash, percent, and underscore as literals", () => {
    assert.equal(escapeLikePattern("a_b"), "a\\_b");
    assert.equal(escapeLikePattern("a%b"), "a\\%b");
    assert.equal(escapeLikePattern("a\\b"), "a\\\\b");
    assert.equal(escapeLikePattern("%_\\"), "\\%\\_\\\\");
    assert.equal(escapeLikePattern("qa_ro_ms"), "qa\\_ro\\_ms");
    assert.equal(escapeLikePattern("wx_qa_ro_mr"), "wx\\_qa\\_ro\\_mr");
  });

  it("leaves ordinary substring text unchanged", () => {
    assert.equal(escapeLikePattern("abc"), "abc");
    assert.equal(escapeLikePattern("王小明"), "王小明");
    assert.equal(escapeLikePattern("EF000315"), "EF000315");
  });

  it("escapes trailing backslash without throwing", () => {
    assert.equal(escapeLikePattern("path\\"), "path\\\\");
    assert.equal(escapeLikePattern("\\"), "\\\\");
  });

  it("escapes quote characters as ordinary text (still parameterized)", () => {
    assert.equal(escapeLikePattern("O'Brien"), "O'Brien");
    assert.equal(escapeLikePattern("%_'"), "\\%\\_'");
  });
});

describe("escapedLike", () => {
  it("builds parameterized LIKE with ESCAPE backslash", () => {
    const expr = escapedLike(schema.customers.email, "qa_ro_ms");
    const text = sqlText(expr);
    assert.match(text, /LIKE/i);
    assert.match(text, /ESCAPE/i);
    assert.ok(text.includes("%qa\\_ro\\_ms%"));
    assert.ok(text.includes(CUSTOMER_SEARCH_LIKE_ESCAPE));
  });

  it("keeps the search pattern as a bound parameter (not raw SQL)", () => {
    const expr = escapedLike(schema.customers.email, "a%' OR 1=1 --");
    const chunks = (expr as { queryChunks?: unknown[] }).queryChunks ?? [];
    const stringChunks = chunks
      .filter(
        (chunk) =>
          chunk &&
          typeof chunk === "object" &&
          "value" in chunk &&
          Array.isArray((chunk as { value: unknown }).value),
      )
      .flatMap((chunk) => (chunk as { value: string[] }).value);
    // SQL keywords around LIKE/ESCAPE only — user payload is a separate param chunk.
    assert.ok(stringChunks.some((s) => /LIKE/i.test(s)));
    assert.ok(stringChunks.some((s) => /ESCAPE/i.test(s)));
    assert.equal(
      stringChunks.some((s) => s.includes("OR 1=1")),
      false,
    );
    assert.ok(chunks.includes("%a\\%' OR 1=1 --%"));
  });
});

describe("buildSearchWhere OR grouping + name_status scope", () => {
  it("keeps name_status=confirmed only on the customerName branch", () => {
    const text = sqlText(buildSearchWhere("qa_ro_ms"));
    assert.match(text, /name_status|nameStatus|col:name_status/i);
    // Five LIKE/ESCAPE clauses: name, phone, wechat, email, customerCode
    const likeCount = (text.match(/LIKE/gi) ?? []).length;
    const escapeCount = (text.match(/ESCAPE/gi) ?? []).length;
    assert.equal(likeCount, 5);
    assert.equal(escapeCount, 5);

    const columns = getTableColumns(schema.customers);
    assert.ok(columns.customerName);
    assert.ok(columns.phone);
    assert.ok(columns.wechatId);
    assert.ok(columns.email);
    assert.ok(columns.customerCode);
  });

  it("uses the same escaped pattern for contact / code branches", () => {
    const parts = collectSqlParts(buildSearchWhere("a_b%\\"));
    const patterns = parts.filter(
      (p) => typeof p === "string" && p.startsWith("%") && p.endsWith("%"),
    );
    assert.ok(patterns.length >= 5);
    assert.ok(patterns.every((p) => p === "%a\\_b\\%\\\\%"));
  });
});

describe("SQLite LIKE ESCAPE literal semantics", () => {
  it("matches underscore / percent / backslash as ordinary characters", () => {
    // Keep this hermetic with the system sqlite3 CLI semantics used by D1.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const script = `
CREATE TABLE c (
  customer_name TEXT,
  name_status TEXT,
  phone TEXT,
  wechat_id TEXT,
  email TEXT,
  customer_code TEXT
);
INSERT INTO c VALUES
  ('張三','confirmed','91234567','wxplain','plain@example.com','EFCONF1'),
  ('X先生','pending','90000001','wx_qa_ro_mr','qa_ro_ms@example.com','EFPEND1'),
  ('X女士','pending','90000002','wxXqaXroXmr','qaxro@example.com','EFPEND2'),
  ('含%名','confirmed','90000003','wxpct','a%b@example.com','EFPCT1'),
  ('斜線','confirmed','90000004','path' || char(92) || 'id','slash' || char(92) || 'mail@example.com','EFSLASH'),
  ('引號','confirmed','90000005','wxquote','o''brien@example.com','EFQUOTE');

SELECT 'email_underscore', count(*) FROM c
  WHERE email LIKE '%qa\\_ro_ms%' ESCAPE '\\';
SELECT 'wechat_underscore', count(*) FROM c
  WHERE wechat_id LIKE '%wx\\_qa\\_ro\\_mr%' ESCAPE '\\';
SELECT 'underscore_not_wildcard', count(*) FROM c
  WHERE email LIKE '%qa\\_ro%' ESCAPE '\\' AND email = 'qaxro@example.com';
SELECT 'a_b_not_axb', count(*) FROM c
  WHERE email LIKE '%a\\_b%' ESCAPE '\\';
SELECT 'percent_literal', count(*) FROM c
  WHERE email LIKE '%a\\%b%' ESCAPE '\\';
SELECT 'percent_alone', count(*) FROM c
  WHERE email LIKE '%\\%%' ESCAPE '\\';
SELECT 'backslash', count(*) FROM c
  WHERE wechat_id LIKE '%path' || char(92) || char(92) || 'id%' ESCAPE char(92);
SELECT 'pending_name_blocked', count(*) FROM c
  WHERE name_status = 'confirmed' AND customer_name LIKE '%X先生%' ESCAPE '\\';
SELECT 'pending_email_ok', count(*) FROM c
  WHERE email LIKE '%qa\\_ro_ms%' ESCAPE '\\';
SELECT 'pending_code_ok', count(*) FROM c
  WHERE customer_code LIKE '%EFPEND1%' ESCAPE '\\';
SELECT 'quote_safe', count(*) FROM c
  WHERE email LIKE '%o''brien%' ESCAPE '\\';
`;
    const out = execFileSync("sqlite3", [":memory:"], {
      input: script,
      encoding: "utf8",
    });
    const map = Object.fromEntries(
      out
        .trim()
        .split("\n")
        .map((line) => {
          const [k, v] = line.split("|");
          return [k, Number(v)];
        }),
    );
    assert.equal(map.email_underscore, 1);
    assert.equal(map.wechat_underscore, 1);
    assert.equal(map.underscore_not_wildcard, 0);
    assert.equal(map.a_b_not_axb, 0);
    assert.equal(map.percent_literal, 1);
    assert.equal(map.percent_alone, 1);
    assert.equal(map.backslash, 1);
    assert.equal(map.pending_name_blocked, 0);
    assert.equal(map.pending_email_ok, 1);
    assert.equal(map.pending_code_ok, 1);
    assert.equal(map.quote_safe, 1);
  });
});
