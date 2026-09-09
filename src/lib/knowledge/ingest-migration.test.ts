import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Knowledge Package 3 migration boundary", () => {
  it("adds only source and AI-run tables with private-storage lifecycle fields", () => {
    const migration = readFileSync(
      join(process.cwd(), "drizzle/migrations/0078_knowledge_ingest.sql"),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE knowledge_sources/);
    assert.match(migration, /CREATE TABLE knowledge_ai_organization_runs/);
    for (const field of [
      "raw_text",
      "storage_key",
      "content_hash",
      "failure_code",
      "linked_article_id",
      "proposed_body",
    ]) {
      assert.match(migration, new RegExp(`\\b${field}\\b`));
    }
    assert.match(migration, /WHERE status IN \('pending', 'processing'\)/);
    assert.doesNotMatch(
      migration,
      /DROP TABLE|ALTER TABLE|customer_id|contact_id|lead_id|mail_message_id/,
    );
    assert.doesNotMatch(migration, /r2\.dev|https?:\/\//i);
  });

  it("does not change the production Wrangler bindings or Mail settings", () => {
    const wrangler = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
    assert.doesNotMatch(wrangler, /KNOWLEDGE_SOURCES|crm-knowledge-sources/);
    assert.match(wrangler, /MAIL_LARGE_ATTACHMENT_RUNTIME_ENABLED": "true"/);
    assert.match(wrangler, /MAIL_LARGE_ATTACHMENT_SEND_ENABLED": "true"/);
  });
});
