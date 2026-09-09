import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

describe("Knowledge Package 5 mobile Search and AI UI", () => {
  it("keeps one Knowledge surface, readable cards, and safe click states", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/components/knowledge/knowledge-search-ai-panel.tsx",
      ),
      "utf8",
    );
    assert.match(source, /Search Knowledge|搜索 Knowledge/);
    assert.match(source, /Ask Knowledge AI/);
    assert.match(source, /disabled={busy/);
    assert.match(source, /whitespace-pre-wrap break-words/);
    assert.match(source, /flex flex-col/);
    assert.doesNotMatch(source, /<table|dangerouslySetInnerHTML|<iframe/);
  });
});
