import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import { createEmptyCustomerCreateFormData } from "@/lib/customers/customer-create-draft";
import { validateCustomerInput } from "@/lib/customers/validation";

const DRAFT_KEYS = [
  "identityAndNeedsSection",
  "contactSection",
  "phoneWechatGuidance",
  "emailRecommended",
  "stageNotesHelper",
  "draftSavedAt",
  "draftStorageUnavailable",
  "draftRestoreTitle",
  "draftRestoreDescription",
  "draftRestoreContinue",
  "draftRestoreDiscard",
] as const;

describe("customer create Phase 1A form defaults and i18n", () => {
  it("defaults sales stage to new_lead", () => {
    assert.equal(createEmptyCustomerCreateFormData().salesStage, "new_lead");
  });

  it("keeps phone-or-wechat validation", () => {
    const base = {
      ...createEmptyCustomerCreateFormData(),
      customerName: "測試",
      requestedProjectName: "簽證諮詢服務",
      source: "other",
      sourceRemark: "朋友介紹詳情",
      notes: "客戶目前需求與辦理目的說明足夠",
      phone: "",
      wechatId: "",
    };
    const missing = validateCustomerInput(base, {
      requireSalesStage: true,
      allowedSourceKeys: ["other"],
    });
    assert.equal(
      missing.some((e) => e.code === "PHONE_OR_WECHAT_REQUIRED"),
      true,
    );

    const withPhone = validateCustomerInput(
      { ...base, phone: "13800138000" },
      { requireSalesStage: true, allowedSourceKeys: ["other"] },
    );
    assert.equal(
      withPhone.some((e) => e.code === "PHONE_OR_WECHAT_REQUIRED"),
      false,
    );
  });

  it("keeps notes minimum length rule", () => {
    const short = validateCustomerInput(
      {
        ...createEmptyCustomerCreateFormData(),
        customerName: "測試",
        requestedProjectName: "簽證諮詢服務",
        source: "referral",
        phone: "13800138000",
        notes: "太短",
      },
      { requireSalesStage: true, allowedSourceKeys: ["referral"] },
    );
    assert.equal(
      short.some((e) => e.code === "STAGE_NOTES_REQUIRED"),
      true,
    );
  });

  it("has Phase 1A customer copy keys in all locales", () => {
    for (const key of DRAFT_KEYS) {
      assert.equal(typeof en.customers[key], "string", `en ${key}`);
      assert.equal(typeof zhHans.customers[key], "string", `zh-Hans ${key}`);
      assert.equal(typeof zhHant.customers[key], "string", `zh-Hant ${key}`);
    }

    assert.equal(en.customers.sourceAndStage, "Source and Communication");
    assert.equal(zhHans.customers.sourceAndStage, "来源与沟通");
    assert.equal(zhHant.customers.sourceAndStage, "來源與溝通");
    assert.equal(en.customers.stageNotes, "Initial Communication");
    assert.equal(zhHans.customers.stageNotes, "首次沟通情况");
    assert.equal(zhHant.customers.stageNotes, "首次溝通情況");
    assert.match(en.customers.draftSavedAt, /Draft saved on this device/);
    assert.match(zhHans.customers.draftSavedAt, /草稿已保存在此设备/);
    assert.match(zhHant.customers.draftSavedAt, /草稿已保存在此設備/);
  });
});
