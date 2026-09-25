import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

describe("knowledge migration 0090 candidate compare/convert", () => {
  const sql = readFileSync(
    join(root, "drizzle/migrations/0090_knowledge_candidate_compare_convert.sql"),
    "utf8",
  );

  it("adds candidate_id to comparison runs", () => {
    assert.match(sql, /knowledge_ai_comparison_runs/);
    assert.match(sql, /candidate_id/);
  });

  it("adds draft_article_id to segment candidates", () => {
    assert.match(sql, /draft_article_id/);
    assert.match(sql, /knowledge_source_segment_candidates/);
  });

  it("splits active comparison uniqueness", () => {
    assert.match(sql, /uq_knowledge_ai_comparison_runs_active_source_legacy/);
    assert.match(sql, /uq_knowledge_ai_comparison_runs_active_candidate/);
  });

  it("leaves prior feature migrations present", () => {
    assert.ok(
      readFileSync(
        join(root, "drizzle/migrations/0088_knowledge_source_segment_candidates.sql"),
        "utf8",
      ).includes("knowledge_source_segment_candidates"),
    );
    assert.ok(
      readFileSync(
        join(root, "drizzle/migrations/0089_knowledge_ai_organization_candidate.sql"),
        "utf8",
      ).includes("candidate_id"),
    );
  });
});
