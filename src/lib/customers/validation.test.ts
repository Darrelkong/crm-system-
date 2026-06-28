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
  const sourceKeys = ["referral", "other"];

  it("fails create when sales stage is missing", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "" },
      { requireSalesStage: true, allowedSourceKeys: sourceKeys },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_REQUIRED"));
  });

  it("passes create when sales stage is selected", () => {
    const errors = validateCustomerInput(BASE_INPUT, {
      requireSalesStage: true,
      allowedSourceKeys: sourceKeys,
    });
    assert.equal(errors.some((e) => e.code === "SALES_STAGE_REQUIRED"), false);
  });

  it("does not require sales stage on update", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "" },
      {
        isUpdate: true,
        existingNotes: BASE_INPUT.notes,
        allowedSourceKeys: sourceKeys,
      },
    );
    assert.equal(errors.some((e) => e.code === "SALES_STAGE_REQUIRED"), false);
  });

  it("blocks staff create with closed_won", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "closed_won" },
      {
        requireSalesStage: true,
        allowedSourceKeys: sourceKeys,
        userRole: "staff",
      },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
  });

  it("blocks staff create with closed_lost", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "closed_lost" },
      {
        requireSalesStage: true,
        allowedSourceKeys: sourceKeys,
        userRole: "staff",
      },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
  });

  it("blocks admin create with closed_won", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "closed_won" },
      {
        requireSalesStage: true,
        allowedSourceKeys: sourceKeys,
        userRole: "admin",
      },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
  });

  it("blocks admin create with closed_lost", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "closed_lost" },
      {
        requireSalesStage: true,
        allowedSourceKeys: sourceKeys,
        userRole: "admin",
      },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
  });

  it("allows admin update transitioning to closed_won", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "closed_won" },
      {
        isUpdate: true,
        existingNotes: BASE_INPUT.notes,
        existingSalesStage: "negotiation",
        allowedSourceKeys: sourceKeys,
        userRole: "admin",
      },
    );
    assert.equal(
      errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"),
      false,
    );
  });

  it("blocks staff update transitioning to closed_won", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "closed_won" },
      {
        isUpdate: true,
        existingNotes: BASE_INPUT.notes,
        existingSalesStage: "negotiation",
        allowedSourceKeys: sourceKeys,
        userRole: "staff",
      },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
  });

  it("allows staff update when closed_won is unchanged", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "closed_won" },
      {
        isUpdate: true,
        existingNotes: BASE_INPUT.notes,
        existingSalesStage: "closed_won",
        allowedSourceKeys: sourceKeys,
        userRole: "staff",
      },
    );
    assert.equal(
      errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"),
      false,
    );
  });

  it("blocks import rows with direct terminal sales stages", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "closed_lost" },
      { disallowDirectTerminalSalesStages: true },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
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
