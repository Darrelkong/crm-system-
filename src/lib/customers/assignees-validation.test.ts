import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASSIGNEE_UPDATE_ACTION,
  validateAssigneeUpdatePayload,
  validateCollaboratorUserIds,
} from "./assignees-validation";

describe("validateCollaboratorUserIds", () => {
  it("rejects non-array input", () => {
    const result = validateCollaboratorUserIds("not-an-array");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors[0]?.field, "requestedCollaboratorIds");
    }
  });

  it("accepts empty array", () => {
    const result = validateCollaboratorUserIds([]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, []);
    }
  });

  it("deduplicates duplicate ids", () => {
    const result = validateCollaboratorUserIds([
      "11111111-1111-1111-1111-111111111103",
      "11111111-1111-1111-1111-111111111103",
    ]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, [
        "11111111-1111-1111-1111-111111111103",
      ]);
    }
  });

  it("rejects empty string id", () => {
    const result = validateCollaboratorUserIds(["", "valid-id"]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.errors[0]?.message ?? "", /不能为空/);
    }
  });

  it("rejects non-string id", () => {
    const result = validateCollaboratorUserIds([123]);
    assert.equal(result.ok, false);
  });
});

describe("validateAssigneeUpdatePayload", () => {
  it("rejects invalid action", () => {
    const result = validateAssigneeUpdatePayload({
      action: "replace_owner",
      requestedCollaboratorIds: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors[0]?.field, "action");
    }
  });

  it("accepts valid set_collaborators payload", () => {
    const result = validateAssigneeUpdatePayload({
      action: ASSIGNEE_UPDATE_ACTION,
      requestedCollaboratorIds: [
        "11111111-1111-1111-1111-111111111103",
        "11111111-1111-1111-1111-111111111103",
      ],
      currentCollaboratorIds: [],
      addedUserIds: ["11111111-1111-1111-1111-111111111103"],
      removedUserIds: [],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.action, ASSIGNEE_UPDATE_ACTION);
      assert.deepEqual(result.value.requestedCollaboratorIds, [
        "11111111-1111-1111-1111-111111111103",
      ]);
      assert.deepEqual(result.value.addedUserIds, [
        "11111111-1111-1111-1111-111111111103",
      ]);
    }
  });

  it("requires requestedCollaboratorIds", () => {
    const result = validateAssigneeUpdatePayload({
      action: ASSIGNEE_UPDATE_ACTION,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors[0]?.field, "requestedCollaboratorIds");
    }
  });
});
