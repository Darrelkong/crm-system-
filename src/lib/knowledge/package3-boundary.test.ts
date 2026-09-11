import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routes = [
  "src/app/api/knowledge/sources/route.ts",
  "src/app/api/knowledge/sources/[id]/route.ts",
  "src/app/api/knowledge/sources/[id]/organize/route.ts",
  "src/app/api/knowledge/sources/[id]/convert/route.ts",
];

const patchRoute = "src/app/api/knowledge/sources/[id]/route.ts";

describe("Knowledge Package 3 boundaries", () => {
  it("protects every source route with Package 1 Knowledge guards", () => {
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      assert.match(source, /requireKnowledgeAccess/);
      assert.doesNotMatch(
        source,
        /\b(customer_id|contact_id|lead_id|mail_message_id|approval_id|follow_up_id)\b/,
      );
    }
  });

  it("supports archive and restore through PATCH without delete endpoints", () => {
    const source = readFileSync(patchRoute, "utf8");
    assert.match(source, /archiveKnowledgeSource/);
    assert.match(source, /restoreKnowledgeSource/);
    assert.match(source, /input\.archive === true/);
    assert.match(source, /input\.restore === true/);
    assert.doesNotMatch(source, /\bDELETE\b/);
  });

  it("keeps raw files private and blocks automatic publication", () => {
    const source = readFileSync(
      "src/lib/knowledge/source-storage.ts",
      "utf8",
    );
    assert.match(source, /KNOWLEDGE_SOURCE_KEY_PREFIX/);
    assert.doesNotMatch(source, /r2\.dev|public|downloadUrl/i);
    const ui = readFileSync(
      "src/components/knowledge/knowledge-ingest-client.tsx",
      "utf8",
    );
    assert.match(ui, /aiLabel/);
    assert.match(ui, /saveDraft/);
    assert.doesNotMatch(ui, /Publish|发布|發佈|approve|批准/);
  });
});
