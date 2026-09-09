import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

describe("Knowledge Package 2 migration", () => {
  it("adds only the three independent core tables", () => {
    const migration = readFileSync(
      join(process.cwd(), "drizzle/migrations/0077_knowledge_core.sql"),
      "utf8",
    );
    for (const table of [
      "knowledge_categories",
      "knowledge_articles",
      "knowledge_article_versions",
    ]) {
      assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
    }
    assert.match(migration, /ON DELETE RESTRICT/);
    assert.doesNotMatch(
      migration,
      /\b(customer_id|contact_id|lead_id|mail_message_id|approval_id|follow_up_id)\b/,
    );
    assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE users|ALTER TABLE customers/);
  });
});
