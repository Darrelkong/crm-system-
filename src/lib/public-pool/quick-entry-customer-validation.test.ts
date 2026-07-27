import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import { prepareDirectPublicPoolCustomerCreation } from "@/lib/public-pool/quick-entry-customer-service";
import {
  QUICK_ENTRY_CUSTOMER_ERROR_CODES,
  QUICK_ENTRY_NOTE_MAX_LENGTH,
  isValidQuickEntryCustomerName,
  validateQuickEntryCustomerInput,
} from "@/lib/public-pool/quick-entry-customer-validation";
import type { User } from "../../../drizzle/schema/users";

const validBase = {
  customerName: "张三",
  phone: "13800138000",
  requestedProjectName: "移民项目咨询",
};

const staffActor = {
  id: "11111111-1111-1111-1111-111111111102",
  role: "staff",
  isActive: 1,
  deletedAt: null,
  mustChangePassword: 0,
} as User;

describe("isValidQuickEntryCustomerName", () => {
  it("accepts Chinese names of length 2–5", () => {
    for (const name of ["王明", "王小明", "歐陽娜娜", "阿布都熱依"]) {
      assert.equal(isValidQuickEntryCustomerName(name), true, name);
    }
  });

  it("rejects Chinese names outside 2–5 or with extras", () => {
    for (const name of [
      "王",
      "王小明明明明",
      "王小明123",
      "王 John",
      "王 小明",
      "王小明！",
      "12345",
      "王Ming",
      "John 王",
    ]) {
      assert.equal(isValidQuickEntryCustomerName(name), false, name);
    }
  });

  it("accepts English names with spaces, hyphens, and apostrophes", () => {
    for (const name of [
      "John Smith",
      "Michael Chan",
      "Mary-Jane Lee",
      "O'Connor",
    ]) {
      assert.equal(isValidQuickEntryCustomerName(name), true, name);
    }
  });

  it("rejects English names with digits, Chinese, or other symbols", () => {
    for (const name of [
      "John2",
      "John Smith!",
      "John_Smith",
      "   ",
      "---",
      "'''",
      "Mr. X",
      "Ms. X",
    ]) {
      assert.equal(isValidQuickEntryCustomerName(name), false, name);
    }
  });
});

describe("validateQuickEntryCustomerInput name rules", () => {
  it("accepts valid Chinese and English names", () => {
    for (const customerName of [
      "王明",
      "王小明",
      "歐陽娜娜",
      "阿布都熱依",
      "John Smith",
      "Mary-Jane Lee",
      "O'Connor",
    ]) {
      const result = validateQuickEntryCustomerInput({
        ...validBase,
        customerName,
      });
      assert.equal(result.ok, true, customerName);
    }
  });

  it("rejects pending placeholders X先生 / X女士", () => {
    for (const customerName of ["X先生", "X女士"]) {
      const result = validateQuickEntryCustomerInput({
        ...validBase,
        customerName,
      });
      assert.equal(result.ok, false, customerName);
      if (!result.ok) {
        assert.equal(
          result.errors[0]?.errorCode,
          QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_PLACEHOLDER_FORBIDDEN,
          customerName,
        );
      }
    }
  });

  it("rejects invalid Chinese / mixed / symbol names", () => {
    for (const customerName of [
      "王",
      "王小明明明明",
      "王小明123",
      "王 John",
      "王 小明",
      "王小明！",
      "John2",
      "John 王",
    ]) {
      const result = validateQuickEntryCustomerInput({
        ...validBase,
        customerName,
      });
      assert.equal(result.ok, false, customerName);
      if (!result.ok) {
        assert.equal(
          result.errors[0]?.errorCode,
          QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_INVALID,
          customerName,
        );
      }
    }
  });
});

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
            (e) =>
              e.errorCode === QUICK_ENTRY_CUSTOMER_ERROR_CODES.PHONE_INVALID,
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

describe("prepareDirectPublicPoolCustomerCreation name gate", () => {
  it("rejects illegal names before insert (no customer created)", async () => {
    for (const customerName of ["X先生", "王", "王 John", "John2"]) {
      const result = await prepareDirectPublicPoolCustomerCreation({
        actor: staffActor,
        customer: {
          customerName,
          phone: "13800138000",
          requestedProjectName: "移民项目咨询",
        },
      });
      assert.equal(result.kind, "invalid", customerName);
      assert.equal("customerId" in result, false, customerName);
      assert.equal("statements" in result, false, customerName);
    }
  });
});

describe("quick-entry name i18n parity", () => {
  it("keeps validation and API error copy aligned across locales", () => {
    assert.ok(
      zhHant.publicPool.quickEntry.validation.name_invalid.includes("2～5"),
    );
    assert.ok(
      zhHans.publicPool.quickEntry.validation.name_invalid.includes("2～5"),
    );
    assert.ok(
      en.publicPool.quickEntry.validation.name_invalid.includes("2–5"),
    );
    assert.match(
      zhHant.publicPool.quickEntry.validation.name_placeholder_forbidden,
      /X先生/,
    );
    assert.match(
      zhHans.publicPool.quickEntry.validation.name_placeholder_forbidden,
      /X先生/,
    );
    assert.match(
      en.publicPool.quickEntry.validation.name_placeholder_forbidden,
      /X先生/,
    );
    assert.equal(
      zhHant.publicPool.quickEntry.errors.namePlaceholderForbidden,
      zhHant.publicPool.quickEntry.validation.name_placeholder_forbidden,
    );
    assert.equal(
      zhHans.publicPool.quickEntry.errors.namePlaceholderForbidden,
      zhHans.publicPool.quickEntry.validation.name_placeholder_forbidden,
    );
    assert.equal(
      en.publicPool.quickEntry.errors.namePlaceholderForbidden,
      en.publicPool.quickEntry.validation.name_placeholder_forbidden,
    );
  });
});
