import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge migration 0083 boundary", () => {
  it("adds only additive extraction metadata columns", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "drizzle/migrations/0083_knowledge_source_extraction_metadata.sql",
      ),
      "utf8",
    );
    for (const field of [
      "extraction_method",
      "extraction_model",
      "extraction_metadata_json",
      "page_count",
    ]) {
      assert.match(migration, new RegExp(`\\b${field}\\b`));
    }
    assert.doesNotMatch(migration, /DROP TABLE|UPDATE knowledge_sources|DELETE FROM/i);
  });
});
