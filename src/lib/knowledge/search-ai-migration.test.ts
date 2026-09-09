import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge Package 5 migration boundary", () => {
  it("adds only bounded AI usage metadata and never stores content", () => {
    const migration = readFileSync(
      join(process.cwd(), "drizzle/migrations/0080_knowledge_search_ai.sql"),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE knowledge_ai_query_runs/);
    assert.match(migration, /query_hash/);
    assert.match(migration, /retrieved_source_count/);
    assert.match(
      migration,
      /WHERE status IN \('pending', 'processing'\)/,
    );
    const sql = migration.replace(/--.*$/gm, "");
    assert.doesNotMatch(
      sql,
      /raw_question|question TEXT|answer TEXT|prompt|context|body|raw_text|customer_id|mail_message_id/i,
    );
    assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE/);
  });
});
