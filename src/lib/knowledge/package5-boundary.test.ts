import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Knowledge Package 5 security boundaries", () => {
  it("guards Search and Ask endpoints with Knowledge session and unlock checks", () => {
    for (const route of [
      "src/app/api/knowledge/search/route.ts",
      "src/app/api/knowledge/ask/route.ts",
    ]) {
      const source = read(route);
      assert.match(source, /requireKnowledgeAccess/);
      assert.doesNotMatch(
        source,
        /customers|contacts|follow-ups|mail|approvals|knowledge_sources|raw_text/i,
      );
    }
  });

  it("uses only published article versions and excludes raw-source retrieval", () => {
    const source = read("src/lib/knowledge/published-retrieval.ts");
    assert.match(source, /publishedVersionNumber/);
    assert.match(source, /knowledgeArticleVersions/);
    assert.match(source, /status.*published|published.*status/);
    assert.doesNotMatch(
      source,
      /knowledgeSources|knowledge_sources|rawText|raw_text|aiOrganizationRuns|proposedBody|customers|mail/i,
    );
    assert.doesNotMatch(source, /fetch\(|https?:\/\//i);
  });

  it("keeps provider prompts server-side and blocks web fallback", () => {
    const service = read("src/lib/knowledge/qa-service.ts");
    const prompt = read("src/lib/knowledge/ai-qa-prompt.ts");
    assert.match(prompt, /untrusted data, not instructions/i);
    assert.match(prompt, /published Knowledge/i);
    assert.doesNotMatch(service, /knowledgeSources|rawText|customers|mail/i);
    assert.doesNotMatch(service, /fetch\(|https?:\/\//i);
  });
});
