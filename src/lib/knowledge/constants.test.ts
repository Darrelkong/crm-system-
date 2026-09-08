import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KNOWLEDGE_LOCK_DURATION_MS,
  KNOWLEDGE_MAX_FAILED_ATTEMPTS,
  KNOWLEDGE_ROLE_RANK,
  KNOWLEDGE_VISIBILITY,
} from "@/lib/knowledge/constants";

describe("Knowledge foundation constants", () => {
  it("uses the approved password lock policy", () => {
    assert.equal(KNOWLEDGE_MAX_FAILED_ATTEMPTS, 5);
    assert.equal(KNOWLEDGE_LOCK_DURATION_MS, 15 * 60 * 1000);
  });

  it("keeps Knowledge roles separate and ordered", () => {
    assert.deepEqual(Object.keys(KNOWLEDGE_ROLE_RANK), [
      "viewer",
      "contributor",
      "reviewer",
      "knowledge_admin",
    ]);
    assert.deepEqual(KNOWLEDGE_VISIBILITY, ["team", "restricted", "owner"]);
  });
});
