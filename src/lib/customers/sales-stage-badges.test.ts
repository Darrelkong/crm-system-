import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIFECYCLE_STATUS_COMPLETED,
  resolveSalesStageListDisplay,
  shouldShowPendingSecondConversionBadge,
} from "./sales-stage-badges";

describe("shouldShowPendingSecondConversionBadge", () => {
  it("shows for completed active customers", () => {
    assert.equal(
      shouldShowPendingSecondConversionBadge({
        lifecycleStatus: LIFECYCLE_STATUS_COMPLETED,
        status: "active",
      }),
      true,
    );
  });

  it("hides for non-completed customers", () => {
    assert.equal(
      shouldShowPendingSecondConversionBadge({
        lifecycleStatus: null,
        status: "active",
      }),
      false,
    );
  });

  it("hides for paid but not completed customers", () => {
    assert.equal(
      shouldShowPendingSecondConversionBadge({
        lifecycleStatus: null,
        status: "active",
      }),
      false,
    );
  });

  it("hides for archived customers", () => {
    assert.equal(
      shouldShowPendingSecondConversionBadge({
        lifecycleStatus: LIFECYCLE_STATUS_COMPLETED,
        status: "archived",
        isArchived: true,
      }),
      false,
    );
  });

  it("hides for public_pool customers", () => {
    assert.equal(
      shouldShowPendingSecondConversionBadge({
        lifecycleStatus: LIFECYCLE_STATUS_COMPLETED,
        status: "public_pool",
      }),
      false,
    );
  });

  it("hides for deleted customers", () => {
    assert.equal(
      shouldShowPendingSecondConversionBadge({
        lifecycleStatus: LIFECYCLE_STATUS_COMPLETED,
        status: "active",
        deletedAt: "2026-07-08T12:00:00.000Z",
      }),
      false,
    );
  });
});

describe("resolveSalesStageListDisplay", () => {
  it("returns pending_second_conversion for completed customers", () => {
    assert.equal(
      resolveSalesStageListDisplay({
        lifecycleStatus: LIFECYCLE_STATUS_COMPLETED,
        status: "active",
        salesStage: "paid",
      }),
      "pending_second_conversion",
    );
  });

  it("returns negotiation_reminder for negotiation stage", () => {
    assert.equal(
      resolveSalesStageListDisplay({
        lifecycleStatus: null,
        status: "active",
        salesStage: "negotiation",
      }),
      "negotiation_reminder",
    );
  });

  it("returns plain for other stages", () => {
    assert.equal(
      resolveSalesStageListDisplay({
        lifecycleStatus: null,
        status: "active",
        salesStage: "new_lead",
      }),
      "plain",
    );
  });

  it("prioritizes pending_second_conversion over negotiation", () => {
    assert.equal(
      resolveSalesStageListDisplay({
        lifecycleStatus: LIFECYCLE_STATUS_COMPLETED,
        status: "active",
        salesStage: "negotiation",
      }),
      "pending_second_conversion",
    );
  });

  it("does not affect paid without completed lifecycle", () => {
    assert.equal(
      resolveSalesStageListDisplay({
        lifecycleStatus: null,
        status: "active",
        salesStage: "paid",
      }),
      "plain",
    );
  });
});
