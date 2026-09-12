import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge comparison migration", () => {
  it("adds only knowledge_ai_comparison_runs with required constraints", () => {
    const migration = readFileSync(
      join(process.cwd(), "drizzle/migrations/0082_knowledge_ai_comparison_runs.sql"),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE knowledge_ai_comparison_runs/);
    assert.match(migration, /organization_run_id TEXT NOT NULL/);
    assert.match(migration, /candidate_snapshot_json TEXT NOT NULL/);
    assert.match(migration, /comparison_json TEXT/);
    assert.match(migration, /relationship IN \('update_existing', 'new_article', 'ambiguous', 'no_match'\)/);
    assert.match(
      migration,
      /WHERE status IN \('pending', 'processing'\)/,
    );
    assert.doesNotMatch(migration, /latest_comparison_run_id/);
    assert.doesNotMatch(migration, /DROP TABLE/);
  });
});
