import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  QUICK_ENTRY_CUSTOMER_ERROR_CODES,
  QUICK_ENTRY_NOTE_MAX_LENGTH,
  validateQuickEntryCustomerInput,
} from "@/lib/public-pool/quick-entry-customer-validation";

const validBase = {
  customerName: "张三",
  phone: "13800138000",
  requestedProjectName: "移民项目咨询",
};

describe("validateQuickEntryCustomerInput", () => {
  it("accepts phone only", () => {
    const result = validateQuickEntryCustomerInput(validBase);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.phone, "13800138000");
      assert.equal(result.value.wechatId, null);
      assert.equal(result.value.phoneCountryCode, "+86");
    }
  });

  it("accepts wechat only", () => {
    const result = validateQuickEntryCustomerInput({
      customerName: "李四",
      wechatId: "wechat_user_1",
      requestedProjectName: "留学项目咨询",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.phone, null);
      assert.equal(result.value.wechatId, "wechat_user_1");
    }
  });

  it("accepts phone + wechat and optional notes", () => {
    const result = validateQuickEntryCustomerInput({
      ...validBase,
      wechatId: "wx_abc",
      initialFollowUpNote: "  首次沟通备注  ",
      supplementalNote: "  补充  ",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.notes, "首次沟通备注");
      assert.equal(result.value.sourceRemark, "补充");
    }
  });

  it("empty optional notes become null", () => {
    const result = validateQuickEntryCustomerInput({
      ...validBase,
      initialFollowUpNote: "   ",
      supplementalNote: "",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.notes, null);
      assert.equal(result.value.sourceRemark, null);
    }
  });

  it("rejects missing / invalid name", () => {
    const missing = validateQuickEntryCustomerInput({
      ...validBase,
      customerName: "  ",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(
        missing.errors[0]?.errorCode,
        QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_REQUIRED,
      );
    }

    const invalid = validateQuickEntryCustomerInput({
      ...validBase,
      customerName: "A",
    });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(
        invalid.errors[0]?.errorCode,
        QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_INVALID,
      );
    }
  });

  it("rejects missing both contacts", () => {
    const result = validateQuickEntryCustomerInput({
      customerName: "王五",
      requestedProjectName: "移民项目咨询",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.errors[0]?.errorCode,
        QUICK_ENTRY_CUSTOMER_ERROR_CODES.CONTACT_REQUIRED,
      );
    }
  });

  it("rejects invalid phone / wechat length", () => {
    const phone = validateQuickEntryCustomerInput({
      ...validBase,
      phone: "12345",
    });
    assert.equal(phone.ok, false);
    if (!phone.ok) {
      assert.equal(
        phone.errors.some(
          (e) => e.errorCode === QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_INVALID,
        ),
        true,
      );
    }

    const wechat = validateQuickEntryCustomerInput({
      customerName: "赵六",
      wechatId: "x".repeat(65),
      requestedProjectName: "移民项目咨询",
    });
    assert.equal(wechat.ok, false);
  });

  it("canonicalizes missing／null／empty country code to +86", () => {
    for (const phoneCountryCode of [undefined, null, "", "  "]) {
      const result = validateQuickEntryCustomerInput({
        ...validBase,
        phoneCountryCode,
      });
      assert.equal(result.ok, true, String(phoneCountryCode));
      if (result.ok) {
        assert.equal(result.value.phoneCountryCode, "+86");
      }
    }
  });

  it("rejects non-+86 country codes", () => {
    for (const phoneCountryCode of ["+1", "+852", "86", "+086"]) {
      const result = validateQuickEntryCustomerInput({
        ...validBase,
        phoneCountryCode,
      });
      assert.equal(result.ok, false, phoneCountryCode);
      if (!result.ok) {
        assert.equal(
          result.errors.some(
            (e) =>
              e.errorCode ===
              QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_COUNTRY_CODE_INVALID,
          ),
          true,
          phoneCountryCode,
        );
      }
    }
  });

  it("rejects phones that are not exactly 1 + 10 ASCII digits", () => {
    for (const phone of [
      "1380013800",
      "138001380000",
      "23800138000",
      "1380013800a",
      "+8613800138000",
      "138-0013-8000",
      "138 0013 8000",
    ]) {
      const result = validateQuickEntryCustomerInput({
        ...validBase,
        phone,
      });
      assert.equal(result.ok, false, phone);
      if (!result.ok) {
        assert.ok(
          result.errors.some(
            (e) => e.errorCode === QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_INVALID,
          ),
          phone,
        );
      }
    }
  });

  it("accepts wechat-only and phone-only and both", () => {
    assert.equal(
      validateQuickEntryCustomerInput({
        customerName: "测试用户",
        wechatId: "wx_only",
        requestedProjectName: "移民项目咨询",
      }).ok,
      true,
    );
    assert.equal(
      validateQuickEntryCustomerInput({
        ...validBase,
        wechatId: "wx_both",
      }).ok,
      true,
    );
  });

  it("maps reproduction payload project short name to PROJECT_INVALID", () => {
    const result = validateQuickEntryCustomerInput({
      customerName: "測試",
      phoneCountryCode: "",
      phone: "13800138000",
      wechatId: "",
      requestedProjectName: "測試",
      initialFollowUpNote: "測試測試測試",
      supplementalNote: "測試測試",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.errors[0]?.errorCode,
        QUICK_ENTRY_CUSTOMER_ERROR_CODES.PROJECT_INVALID,
      );
    }
  });

  it("rejects missing / invalid project", () => {
    const missing = validateQuickEntryCustomerInput({
      customerName: "钱七",
      phone: "13800138001",
      requestedProjectName: "",
    });
    assert.equal(missing.ok, false);

    const invalid = validateQuickEntryCustomerInput({
      customerName: "钱七",
      phone: "13800138001",
      requestedProjectName: "！！！",
    });
    assert.equal(invalid.ok, false);
  });

  it("rejects notes that are too long", () => {
    const result = validateQuickEntryCustomerInput({
      ...validBase,
      initialFollowUpNote: "a".repeat(QUICK_ENTRY_NOTE_MAX_LENGTH + 1),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(
        result.errors[0]?.errorCode,
        QUICK_ENTRY_CUSTOMER_ERROR_CODES.NOTE_TOO_LONG,
      );
    }
  });

  it("ignores client-controlled system fields and does not map them", () => {
    const result = validateQuickEntryCustomerInput({
      ...validBase,
      ownerId: "attacker",
      status: "active",
      source: "other",
      salesStage: "closed_won",
      createdBy: "attacker",
      customerCode: "EF999999",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal("ownerId" in result.value, false);
      assert.equal("status" in result.value, false);
      assert.equal("source" in result.value, false);
      assert.equal("salesStage" in result.value, false);
    }
  });

  it("rejects non-object input", () => {
    assert.equal(validateQuickEntryCustomerInput(null).ok, false);
    assert.equal(validateQuickEntryCustomerInput(["x"]).ok, false);
  });
});
