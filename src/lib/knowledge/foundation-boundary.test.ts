import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(
    new URL(`../../../${relativePath}`, import.meta.url),
    "utf8",
  );
}

describe("Knowledge Package 1 boundaries", () => {
  it("does not introduce a second Access or browser-storage authority", () => {
    const sources = [
      read("src/lib/permissions/knowledge.ts"),
      read("src/lib/knowledge/access-policy-service.ts"),
      read("src/lib/knowledge/unlock-service.ts"),
      read("src/components/knowledge/knowledge-access-form.tsx"),
    ].join("\n");

    assert.doesNotMatch(sources, /access-jwt|verifyCloudflareAccessJwt/);
    assert.doesNotMatch(sources, /localStorage|sessionStorage/);
    assert.doesNotMatch(sources, /LARGE_ATTACHMENTS|CRM_SYSTEM_GATEWAY_SECRET/);
  });

  it("keeps the foundation migration independent of customers and Mail", () => {
    const migration = read("drizzle/migrations/0076_knowledge_foundation.sql");
    assert.doesNotMatch(migration, /customer_id|mail_|LARGE_ATTACHMENTS/i);
    assert.match(migration, /REFERENCES sessions/);
    assert.match(migration, /REFERENCES users/);
  });
});
