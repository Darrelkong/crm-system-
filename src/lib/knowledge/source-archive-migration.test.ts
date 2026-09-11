import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge source archive migration", () => {
  it("adds only archive lifecycle columns and indexes", () => {
    const migration = readFileSync(
      join(process.cwd(), "drizzle/migrations/0081_knowledge_source_archive.sql"),
      "utf8",
    );
    assert.match(migration, /archived_at TEXT/);
    assert.match(migration, /archived_by_user_id TEXT/);
    assert.match(migration, /REFERENCES users \(id\) ON DELETE SET NULL/);
    assert.match(migration, /idx_knowledge_sources_active_updated/);
    assert.match(migration, /idx_knowledge_sources_archived_updated/);
    assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|ALTER TABLE knowledge_sources DROP/);
    assert.doesNotMatch(migration, /status IN \('archived'\)/);
  });
});
