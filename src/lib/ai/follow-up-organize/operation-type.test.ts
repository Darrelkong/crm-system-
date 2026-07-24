import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_USAGE_OPERATION_TYPES } from "../../../../drizzle/schema/ai-usage";

describe("Phase 4C operation type", () => {
  it("includes follow_up_organization without requiring migration CHECK", () => {
    assert.ok(AI_USAGE_OPERATION_TYPES.includes("deep_analysis_refresh"));
    assert.ok(AI_USAGE_OPERATION_TYPES.includes("follow_up_organization"));
  });
});
