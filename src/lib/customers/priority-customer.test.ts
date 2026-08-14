import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminRemovePriorityFields,
  buildAdminSetPriorityFields,
  buildApprovalSetPriorityFields,
  buildOnHoldCreatePriorityFields,
  canRemovePriorityForStage,
  isLegacyLikePinnedSource,
  mergePriorityFieldsForStageTransition,
  resolveSalesStagePriorityTransition,
  shouldSkipSetPriorityMutation,
  shouldSkipUnsetPriorityMutation,
  toPriorityState,
} from "./priority-customer";

const NOW = "2026-08-14T10:00:00.000Z";

describe("priority customer stage matrix", () => {
  it("1. unpinned + enter on_hold → on_hold_auto", () => {
    const patch = resolveSalesStagePriorityTransition(
      "new_lead",
      "on_hold",
      toPriorityState({ isPinned: 0, pinnedAt: null, pinnedSource: null }),
      NOW,
    );
    assert.deepEqual(patch, buildOnHoldCreatePriorityFields(NOW));
  });

  it("2. legacy + enter on_hold → remains legacy", () => {
    const patch = resolveSalesStagePriorityTransition(
      "new_lead",
      "on_hold",
      toPriorityState({ isPinned: 1, pinnedAt: NOW, pinnedSource: "legacy" }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("3. admin_direct + enter on_hold → remains admin_direct", () => {
    const patch = resolveSalesStagePriorityTransition(
      "new_lead",
      "on_hold",
      toPriorityState({
        isPinned: 1,
        pinnedAt: NOW,
        pinnedSource: "admin_direct",
      }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("4. approval + enter on_hold → remains approval", () => {
    const patch = resolveSalesStagePriorityTransition(
      "new_lead",
      "on_hold",
      toPriorityState({ isPinned: 1, pinnedAt: NOW, pinnedSource: "approval" }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("5. pinned + NULL source + enter on_hold → remains pinned / NULL", () => {
    const patch = resolveSalesStagePriorityTransition(
      "new_lead",
      "on_hold",
      toPriorityState({ isPinned: 1, pinnedAt: NOW, pinnedSource: null }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("6. on_hold_auto + leave on_hold → cleared", () => {
    const patch = resolveSalesStagePriorityTransition(
      "on_hold",
      "follow_up",
      toPriorityState({
        isPinned: 1,
        pinnedAt: NOW,
        pinnedSource: "on_hold_auto",
      }),
      NOW,
    );
    assert.deepEqual(patch, buildAdminRemovePriorityFields());
  });

  it("7. legacy + leave on_hold → remains Priority", () => {
    const patch = resolveSalesStagePriorityTransition(
      "on_hold",
      "follow_up",
      toPriorityState({ isPinned: 1, pinnedAt: NOW, pinnedSource: "legacy" }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("8. admin_direct + leave on_hold → remains Priority", () => {
    const patch = resolveSalesStagePriorityTransition(
      "on_hold",
      "follow_up",
      toPriorityState({
        isPinned: 1,
        pinnedAt: NOW,
        pinnedSource: "admin_direct",
      }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("9. approval + leave on_hold → remains Priority", () => {
    const patch = resolveSalesStagePriorityTransition(
      "on_hold",
      "follow_up",
      toPriorityState({ isPinned: 1, pinnedAt: NOW, pinnedSource: "approval" }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("10. pinned + NULL source + leave on_hold → remains Priority", () => {
    const patch = resolveSalesStagePriorityTransition(
      "on_hold",
      "follow_up",
      toPriorityState({ isPinned: 1, pinnedAt: NOW, pinnedSource: null }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("11. ordinary stage transition → Priority unchanged", () => {
    const patch = resolveSalesStagePriorityTransition(
      "new_lead",
      "contacted",
      toPriorityState({ isPinned: 0, pinnedAt: null, pinnedSource: null }),
      NOW,
    );
    assert.equal(patch, null);
  });

  it("12. on_hold → on_hold → no rewrite", () => {
    const patch = resolveSalesStagePriorityTransition(
      "on_hold",
      "on_hold",
      toPriorityState({
        isPinned: 1,
        pinnedAt: NOW,
        pinnedSource: "on_hold_auto",
      }),
      NOW,
    );
    assert.equal(patch, null);
  });
});

describe("priority customer helpers", () => {
  it("mergePriorityFieldsForStageTransition returns audit action on enter on_hold", () => {
    const result = mergePriorityFieldsForStageTransition(
      "new_lead",
      "on_hold",
      { isPinned: 0, pinnedAt: null, pinnedSource: null },
      NOW,
    );
    assert.ok(result.patch);
    assert.equal(result.auditAction, "customer.priority.auto_set_on_hold");
  });

  it("isLegacyLikePinnedSource treats legacy and null as legacy-like", () => {
    assert.equal(isLegacyLikePinnedSource("legacy"), true);
    assert.equal(isLegacyLikePinnedSource(null), true);
    assert.equal(isLegacyLikePinnedSource("admin_direct"), false);
  });

  it("canRemovePriorityForStage blocks on_hold", () => {
    assert.equal(canRemovePriorityForStage("on_hold"), false);
    assert.equal(canRemovePriorityForStage("paid"), true);
  });

  it("shouldSkipSetPriorityMutation when already pinned", () => {
    assert.equal(shouldSkipSetPriorityMutation({ isPinned: 1, pinnedSource: null }), true);
    assert.equal(shouldSkipSetPriorityMutation({ isPinned: 0, pinnedSource: null }), false);
  });

  it("shouldSkipUnsetPriorityMutation when not pinned or on_hold", () => {
    assert.equal(
      shouldSkipUnsetPriorityMutation({ isPinned: 0, salesStage: "paid" }),
      true,
    );
    assert.equal(
      shouldSkipUnsetPriorityMutation({ isPinned: 1, salesStage: "on_hold" }),
      true,
    );
    assert.equal(
      shouldSkipUnsetPriorityMutation({ isPinned: 1, salesStage: "paid" }),
      false,
    );
  });

  it("buildAdminSetPriorityFields uses admin_direct", () => {
    assert.deepEqual(buildAdminSetPriorityFields(NOW), {
      isPinned: 1,
      pinnedAt: NOW,
      pinnedSource: "admin_direct",
    });
  });

  it("buildApprovalSetPriorityFields uses approval", () => {
    assert.deepEqual(buildApprovalSetPriorityFields(NOW), {
      isPinned: 1,
      pinnedAt: NOW,
      pinnedSource: "approval",
    });
  });
});
