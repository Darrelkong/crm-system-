import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge Package 4 migration boundary", () => {
  it("adds review and immutable publication tables without changing prior migrations", () => {
    const migration = readFileSync(
      join(process.cwd(), "drizzle/migrations/0079_knowledge_review_publish.sql"),
      "utf8",
    );
    assert.match(migration, /ALTER TABLE knowledge_articles/);
    assert.match(migration, /published_version_number/);
    assert.match(migration, /CREATE TABLE knowledge_review_requests/);
    assert.match(migration, /CREATE TABLE knowledge_article_publications/);
    for (const status of [
      "pending",
      "changes_requested",
      "approved",
      "withdrawn",
      "superseded",
    ]) {
      assert.match(migration, new RegExp(status));
    }
    assert.match(migration, /WHERE status = 'pending'/);
    assert.match(migration, /FOREIGN KEY \(article_id, version_number\)/);
    assert.doesNotMatch(
      migration,
      /DROP TABLE|customer_id|contact_id|lead_id|mail_message_id/,
    );
  });
});
