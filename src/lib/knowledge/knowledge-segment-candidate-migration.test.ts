import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge segment candidate migration (0088)", () => {
  it("adds candidate table with segment uniqueness", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "drizzle/migrations/0088_knowledge_source_segment_candidates.sql",
      ),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE knowledge_source_segment_candidates/);
    assert.match(migration, /segment_id TEXT NOT NULL/);
    assert.match(migration, /uq_knowledge_source_segment_candidates_segment/);
    assert.match(migration, /status IN \('pending', 'ready', 'superseded'\)/);
    assert.match(migration, /ON DELETE RESTRICT/);
    assert.doesNotMatch(migration, /knowledge_ai_organization_runs/);
    assert.doesNotMatch(migration, /draft_article_id/);
  });
});
