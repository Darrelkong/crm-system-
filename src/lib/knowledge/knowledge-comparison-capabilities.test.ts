import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canExecuteKnowledgeComparison,
  canViewKnowledgeComparison,
} from "@/lib/knowledge/knowledge-comparison-capabilities";

describe("knowledge comparison capabilities", () => {
  const ownerId = "user-owner";
  const otherId = "user-other";

  it("allows admin and owner contributor to execute", () => {
    assert.equal(
      canExecuteKnowledgeComparison("knowledge_admin", ownerId, ownerId),
      true,
    );
    assert.equal(
      canExecuteKnowledgeComparison("contributor", ownerId, ownerId),
      true,
    );
  });

  it("denies reviewer, viewer, and other contributors execution", () => {
    assert.equal(
      canExecuteKnowledgeComparison("reviewer", otherId, ownerId),
      false,
    );
    assert.equal(
      canExecuteKnowledgeComparison("viewer", ownerId, ownerId),
      false,
    );
    assert.equal(
      canExecuteKnowledgeComparison("contributor", otherId, ownerId),
      false,
    );
  });

  it("allows reviewer read without execution rights", () => {
    assert.equal(canViewKnowledgeComparison("reviewer", otherId, ownerId), true);
    assert.equal(
      canExecuteKnowledgeComparison("reviewer", otherId, ownerId),
      false,
    );
  });

  it("denies viewer read on comparison source context", () => {
    assert.equal(canViewKnowledgeComparison("viewer", ownerId, ownerId), false);
  });
});
