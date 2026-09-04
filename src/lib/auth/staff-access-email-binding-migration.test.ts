import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync(
  new URL("../../../drizzle/migrations/0071_staff_cloudflare_access_email.sql", import.meta.url),
  "utf8",
);

describe("Staff Cloudflare Access Email migration", () => {
  it("adds only a nullable field and normalized unique index", () => {
    assert.match(
      MIGRATION,
      /ALTER TABLE users ADD COLUMN cloudflare_access_email TEXT;/i,
    );
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX uq_users_cloudflare_access_email\s+ON users \(lower\(cloudflare_access_email\)\);/i,
    );
    assert.doesNotMatch(MIGRATION, /\bDROP\b/i);
    assert.doesNotMatch(MIGRATION, /DELETE\s+FROM/i);
    assert.doesNotMatch(MIGRATION, /UPDATE\s+users/i);
  });
});
