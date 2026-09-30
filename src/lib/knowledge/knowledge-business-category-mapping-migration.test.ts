import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge business category mapping migration", () => {
  it("adds mapping table with default-mapping constraints", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "drizzle/migrations/0087_knowledge_business_category_mappings.sql",
      ),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE knowledge_business_category_mappings/);
    assert.match(migration, /requested_project_code TEXT NOT NULL/);
    assert.match(migration, /knowledge_category_id TEXT NOT NULL/);
    assert.match(migration, /is_active INTEGER NOT NULL DEFAULT 1/);
    assert.match(
      migration,
      /uq_knowledge_business_category_mappings_code/,
    );
    assert.match(
      migration,
      /idx_knowledge_business_category_mappings_category/,
    );
    assert.match(migration, /ON DELETE RESTRICT/);
    assert.doesNotMatch(migration, /INSERT INTO knowledge_business_category_mappings/);
  });
});
