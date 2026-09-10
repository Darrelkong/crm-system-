import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

describe("Knowledge Package 4 mobile review UI boundary", () => {
  it("keeps review workflow single-column on mobile with safe publish confirmation", () => {
    const center = readFileSync(
      join(
        process.cwd(),
        "src/components/knowledge/knowledge-review-center-client.tsx",
      ),
      "utf8",
    );
    const actions = readFileSync(
      join(
        process.cwd(),
        "src/components/knowledge/knowledge-review-actions.tsx",
      ),
      "utf8",
    );
    assert.match(center, /grid gap-6 lg:grid-cols/);
    assert.match(center, /flex flex-wrap/);
    assert.match(center, /whitespace-pre-wrap break-words/);
    assert.match(center, /knowledge\.review\.confirmApprovePublish/);
    assert.match(center, /knowledge\.review\.requestChanges/);
    assert.match(center, /knowledge\.review\.exactVersion/);
    assert.doesNotMatch(center, /<table/);
    assert.match(actions, /knowledge\.article\.withdrawReview/);
    assert.match(actions, /knowledge\.article\.submitReview/);
    assert.doesNotMatch(actions, /dangerouslySetInnerHTML|<iframe/);
  });
});
