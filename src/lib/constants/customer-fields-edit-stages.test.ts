import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEditSalesStageOptions } from "./customer-fields";

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
