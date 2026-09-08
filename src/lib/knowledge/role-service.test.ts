import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasKnowledgeCapability,
  hasKnowledgeRoleAtLeast,
  isKnowledgeRole,
} from "@/lib/knowledge/role-service";
import { canViewKnowledgeVisibility } from "@/lib/knowledge/visibility";

describe("Knowledge role primitives", () => {
  it("accepts only the four Knowledge roles", () => {
    assert.equal(isKnowledgeRole("viewer"), true);
    assert.equal(isKnowledgeRole("contributor"), true);
    assert.equal(isKnowledgeRole("reviewer"), true);
    assert.equal(isKnowledgeRole("knowledge_admin"), true);
    assert.equal(isKnowledgeRole("admin"), false);
    assert.equal(isKnowledgeRole("staff"), false);
  });

  it("keeps reviewer access below Knowledge Admin", () => {
    assert.equal(hasKnowledgeRoleAtLeast("reviewer", "contributor"), true);
    assert.equal(hasKnowledgeRoleAtLeast("reviewer", "knowledge_admin"), false);
    assert.equal(hasKnowledgeCapability("viewer", "enter"), true);
    assert.equal(hasKnowledgeCapability("viewer", "submit"), false);
    assert.equal(hasKnowledgeCapability("reviewer", "review"), true);
    assert.equal(hasKnowledgeCapability("reviewer", "manage"), false);
    assert.equal(hasKnowledgeCapability("knowledge_admin", "manage"), true);
  });

  it("does not grant reviewers unrestricted restricted visibility", () => {
    assert.equal(
      canViewKnowledgeVisibility({
        role: "reviewer",
        visibility: "team",
        userId: "user-1",
      }),
      true,
    );
    assert.equal(
      canViewKnowledgeVisibility({
        role: "reviewer",
        visibility: "restricted",
        userId: "user-1",
      }),
      false,
    );
    assert.equal(
      canViewKnowledgeVisibility({
        role: "reviewer",
        visibility: "owner",
        userId: "user-1",
        ownerId: "user-1",
      }),
      true,
    );
    assert.equal(
      canViewKnowledgeVisibility({
        role: "knowledge_admin",
        visibility: "owner",
        userId: "admin",
        ownerId: "owner",
      }),
      true,
    );
  });
});
