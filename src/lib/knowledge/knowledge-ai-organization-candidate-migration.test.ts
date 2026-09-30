import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge AI organization candidate migration (0089)", () => {
  it("adds candidate_id and split active-run uniqueness", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "drizzle/migrations/0089_knowledge_ai_organization_candidate.sql",
      ),
      "utf8",
    );
    assert.match(migration, /candidate_id TEXT REFERENCES knowledge_source_segment_candidates/);
    assert.match(migration, /DROP INDEX uq_knowledge_ai_runs_active_source/);
    assert.match(migration, /uq_knowledge_ai_runs_active_source_legacy/);
    assert.match(migration, /candidate_id IS NULL/);
    assert.match(migration, /uq_knowledge_ai_runs_active_candidate/);
    assert.doesNotMatch(migration, /knowledge_ai_comparison_runs/);
    assert.doesNotMatch(migration, /knowledge_articles/);
  });
});
