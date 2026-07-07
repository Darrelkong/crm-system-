import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEditFormSalesStageOptions,
  buildEditSalesStageOptions,
  CREATABLE_SALES_STAGES,
} from "./customer-fields";

describe("buildEditSalesStageOptions", () => {
  it("excludes paid from admin edit options", () => {
    const options = buildEditSalesStageOptions({ isStaff: false });
    assert.equal(options.includes("paid"), false);
  });

  it("excludes paid from staff edit options", () => {
    const options = buildEditSalesStageOptions({ isStaff: true });
    assert.equal(options.includes("paid"), false);
  });

  it("includes current paid stage when customer is already paid", () => {
    const options = buildEditSalesStageOptions({
      isStaff: false,
      currentSalesStage: "paid",
    });
    assert.equal(options.includes("paid"), true);
  });
});

describe("buildEditFormSalesStageOptions", () => {
  it("includes paid for staff edit options", () => {
    const options = buildEditFormSalesStageOptions({ isStaff: true });
    assert.equal(options.includes("paid"), true);
  });

  it("includes paid for admin edit options", () => {
    const options = buildEditFormSalesStageOptions({ isStaff: false });
    assert.equal(options.includes("paid"), true);
  });

  it("places paid immediately after negotiation", () => {
    const options = buildEditFormSalesStageOptions({ isStaff: true });
    const negotiationIndex = options.indexOf("negotiation");
    assert.ok(negotiationIndex >= 0);
    assert.equal(options[negotiationIndex + 1], "paid");
  });

  it("does not include paid in creatable sales stages for new customers", () => {
    assert.equal(CREATABLE_SALES_STAGES.includes("paid" as never), false);
  });
});
