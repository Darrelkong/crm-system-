import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidCustomerName, validateCustomerInput } from "./validation";

describe("isValidCustomerName Chinese 1–5 rule", () => {
  it("accepts 1, 2, and 5 pure Chinese characters", () => {
    assert.equal(isValidCustomerName("王"), true);
    assert.equal(isValidCustomerName("王明"), true);
    assert.equal(isValidCustomerName("王小明明明"), true);
  });

  it("rejects 6 pure Chinese characters", () => {
    assert.equal(isValidCustomerName("王小明明明明"), false);
  });

  it("trims surrounding spaces before validating", () => {
    assert.equal(isValidCustomerName("  王  "), true);
    assert.equal(isValidCustomerName("  王小明  "), true);
    assert.equal(isValidCustomerName("  王小明明明明  "), false);
  });

  it("rejects Chinese mixed with digits or symbols", () => {
    assert.equal(isValidCustomerName("王小明123"), false);
    assert.equal(isValidCustomerName("王小明！"), false);
    assert.equal(isValidCustomerName("王 小明"), false);
  });

  it("does not apply the 1–5 rule to pending placeholders", () => {
    // Placeholders are gated by nameStatus elsewhere; format helper rejects them as confirmed names.
    assert.equal(isValidCustomerName("X先生"), false);
    assert.equal(isValidCustomerName("X女士"), false);
  });

  it("keeps existing English name rules", () => {
    assert.equal(isValidCustomerName("John Smith"), true);
    assert.equal(isValidCustomerName("Mary-Jane Lee"), true);
    assert.equal(isValidCustomerName("O'Connor"), true);
    assert.equal(isValidCustomerName("John2"), false);
    assert.equal(isValidCustomerName("Jo"), false);
  });
});

const BASE_INPUT = {
  customerName: "张三测试",
  customerType: "individual",
  phoneCountryCode: "+86",
  phone: "13800138000",
  wechatId: "",
  email: "",
  source: "referral",
  sourceRemark: "",
  requestedProjectCode: "hk_bank_account",
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

  it("blocks staff create with paid", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "paid" },
      {
        requireSalesStage: true,
        allowedSourceKeys: sourceKeys,
        userRole: "staff",
      },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
  });

  it("blocks admin create with paid", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "paid" },
      {
        requireSalesStage: true,
        allowedSourceKeys: sourceKeys,
        userRole: "admin",
      },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
  });

  it("blocks staff update transitioning to paid", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "paid" },
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

  it("blocks admin update transitioning to paid", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "paid" },
      {
        isUpdate: true,
        existingNotes: BASE_INPUT.notes,
        existingSalesStage: "negotiation",
        allowedSourceKeys: sourceKeys,
        userRole: "admin",
      },
    );
    assert.ok(errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"));
  });

  it("allows update when paid is unchanged", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, salesStage: "paid" },
      {
        isUpdate: true,
        existingNotes: BASE_INPUT.notes,
        existingSalesStage: "paid",
        allowedSourceKeys: sourceKeys,
        userRole: "admin",
      },
    );
    assert.equal(
      errors.some((e) => e.code === "SALES_STAGE_DIRECT_TERMINAL_BLOCKED"),
      false,
    );
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
