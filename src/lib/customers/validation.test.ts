import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateCustomerInput } from "./validation";

const BASE_INPUT = {
  customerName: "张三测试",
  customerType: "individual",
  phoneCountryCode: "+86",
  phone: "13800138000",
  wechatId: "",
  email: "",
  source: "referral",
  sourceRemark: "",
  requestedProjectName: "网站开发项目",
  notes: "客户当前处于初步沟通阶段，需要进一步跟进确认需求。",
  salesStage: "new_lead",
  status: "active",
};

describe("validateCustomerInput sales stage", () => {
  it("fails create when sales stage is missing", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "" },
      { requireSalesStage: true, allowedSourceKeys: ["referral", "other"] },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_REQUIRED"));
  });

  it("passes create when sales stage is selected", () => {
    const errors = validateCustomerInput(BASE_INPUT, {
      requireSalesStage: true,
      allowedSourceKeys: ["referral", "other"],
    });
    assert.equal(errors.some((e) => e.code === "SALES_STAGE_REQUIRED"), false);
  });

  it("does not require sales stage on update", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "" },
      {
        isUpdate: true,
        existingNotes: BASE_INPUT.notes,
        allowedSourceKeys: ["referral", "other"],
      },
    );
    assert.equal(errors.some((e) => e.code === "SALES_STAGE_REQUIRED"), false);
  });
});

describe("validateCustomerInput customer tags", () => {
  it("accepts dynamic tag keys from allowedSourceKeys", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, source: "custom_channel" },
      {
        requireSalesStage: true,
        allowedSourceKeys: ["custom_channel", "other"],
      },
    );
    assert.equal(errors.some((e) => e.code === "SOURCE_REQUIRED"), false);
  });

  it("rejects source keys not in allowedSourceKeys", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, source: "custom_channel" },
      {
        requireSalesStage: true,
        allowedSourceKeys: ["referral", "other"],
      },
    );
    assert.ok(errors.some((e) => e.code === "SOURCE_REQUIRED"));
  });
});
