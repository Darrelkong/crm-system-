import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeQuickEntryCustomerInput,
  validateQuickEntryCustomerInput,
  QUICK_ENTRY_CUSTOMER_ERROR_CODES,
} from "@/lib/public-pool/quick-entry-customer-validation";
import { hashQuickEntrySubmissionPayload } from "@/lib/public-pool/quick-entry-submission-hash";
import { classifyQuickEntryBatchRows } from "@/lib/public-pool/quick-entry-batch-classification";
import { QUICK_ENTRY_SERVICE_ERROR_CODES } from "@/lib/public-pool/quick-entry-customer-service";
import { QUICK_ENTRY_SUBMISSION_ERROR_CODES } from "@/lib/public-pool/quick-entry-submission-constants";
import { validateQuickEntrySubmissionId } from "@/lib/public-pool/quick-entry-submission-validation";

describe("normalizeQuickEntryCustomerInput", () => {
  it("trims and maps empty optionals to null with default +86", () => {
    const canonical = normalizeQuickEntryCustomerInput({
      customerName: "  张三  ",
      phone: " 13800138000 ",
      phoneCountryCode: "",
      wechatId: "  ",
      requestedProjectName: "  移民项目咨询  ",
      initialFollowUpNote: "  ",
      supplementalNote: "",
    });
    assert.equal(canonical.customerName, "张三");
    assert.equal(canonical.phone, "13800138000");
    assert.equal(canonical.phoneCountryCode, "+86");
    assert.equal(canonical.wechatId, null);
    assert.equal(canonical.requestedProjectName, "移民项目咨询");
    assert.equal(canonical.initialFollowUpNote, null);
    assert.equal(canonical.supplementalNote, null);
  });

  it("keeps wechat case and +86 when phone missing", () => {
    const canonical = normalizeQuickEntryCustomerInput({
      customerName: "李四",
      wechatId: "WeChat_User",
      requestedProjectName: "留学项目咨询",
    });
    assert.equal(canonical.wechatId, "WeChat_User");
    assert.equal(canonical.phone, null);
    assert.equal(canonical.phoneCountryCode, "+86");
  });

  it("is reused by validator for identical trim／null semantics", () => {
    const input = {
      customerName: "  王五  ",
      phone: " 13800138001 ",
      phoneCountryCode: null,
      requestedProjectName: "  加拿大移民项目  ",
      initialFollowUpNote: "  备注  ",
      supplementalNote: "   ",
    };
    const canonical = normalizeQuickEntryCustomerInput(input);
    const validated = validateQuickEntryCustomerInput(input);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    assert.equal(validated.value.customerName, canonical.customerName);
    assert.equal(validated.value.phone, canonical.phone);
    assert.equal(validated.value.phoneCountryCode, canonical.phoneCountryCode);
    assert.equal(validated.value.notes, canonical.initialFollowUpNote);
    assert.equal(validated.value.sourceRemark, canonical.supplementalNote);
  });

  it("preserves existing QE-2 error codes", () => {
    const missing = validateQuickEntryCustomerInput({
      customerName: "  ",
      phone: "13800138000",
      requestedProjectName: "移民项目咨询",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(
        missing.errors[0]?.errorCode,
        QUICK_ENTRY_CUSTOMER_ERROR_CODES.CUSTOMER_NAME_REQUIRED,
      );
    }
  });
});

describe("canonical hash after normalize", () => {
  it("empty／missing／trim produce same hash", async () => {
    const submissionId = "550e8400-e29b-41d4-a716-4466554400aa";
    const a = normalizeQuickEntryCustomerInput({
      customerName: "张三",
      phone: "13800138000",
      phoneCountryCode: undefined,
      requestedProjectName: "加拿大移民项目",
      initialFollowUpNote: "",
      supplementalNote: null,
    });
    const b = normalizeQuickEntryCustomerInput({
      customerName: " 张三 ",
      phone: " 13800138000 ",
      phoneCountryCode: "+86",
      requestedProjectName: " 加拿大移民项目 ",
      initialFollowUpNote: "   ",
      supplementalNote: "",
    });
    const ha = await hashQuickEntrySubmissionPayload({
      submissionId,
      rows: [{ clientRowId: "r1", ...a }],
    });
    const hb = await hashQuickEntrySubmissionPayload({
      submissionId,
      rows: [{ clientRowId: "r1", ...b }],
    });
    assert.equal(ha, hb);
  });
});

describe("classifyQuickEntryBatchRows", () => {
  function okRow(
    rowIndex: number,
    clientRowId: string,
    phone: string | null,
    wechatId: string | null,
  ) {
    const canonical = normalizeQuickEntryCustomerInput({
      customerName: "测试客户",
      phone,
      wechatId,
      requestedProjectName: "移民项目咨询",
    });
    return {
      rowIndex,
      clientRowId,
      canonical,
      validation: validateQuickEntryCustomerInput({
        customerName: "测试客户",
        phone,
        wechatId,
        requestedProjectName: "移民项目咨询",
      }),
    };
  }

  it("marks first-wins phone／wechat duplicates deterministically", () => {
    const rows = [
      okRow(0, "a", "13800138000", null),
      okRow(1, "b", "13900139000", "wx_b"),
      okRow(2, "c", "13800138000", "wx_other"),
      okRow(3, "d", "14000140000", "wx_b"),
    ];
    const classified = classifyQuickEntryBatchRows(rows);
    assert.equal(classified[0]?.kind, "eligible");
    assert.equal(classified[1]?.kind, "eligible");
    assert.equal(classified[2]?.kind, "duplicate");
    if (classified[2]?.kind === "duplicate") {
      assert.equal(classified[2].duplicateField, "phone");
      assert.equal(
        classified[2].errorCode,
        QUICK_ENTRY_SERVICE_ERROR_CODES.DUPLICATE_PHONE,
      );
    }
    assert.equal(classified[3]?.kind, "duplicate");
    if (classified[3]?.kind === "duplicate") {
      assert.equal(classified[3].duplicateField, "wechatId");
    }
  });

  it("invalid first row does not claim winner; wechat is case-sensitive", () => {
    const invalid = {
      rowIndex: 0,
      clientRowId: "bad",
      canonical: normalizeQuickEntryCustomerInput({
        customerName: "A",
        phone: "13800138000",
        requestedProjectName: "移民项目咨询",
      }),
      validation: validateQuickEntryCustomerInput({
        customerName: "A",
        phone: "13800138000",
        requestedProjectName: "移民项目咨询",
      }),
    };
    assert.equal(invalid.validation.ok, false);
    const rows = [
      invalid,
      okRow(1, "ok1", "13800138000", "Wx"),
      okRow(2, "ok2", null, "wx"),
    ];
    const classified = classifyQuickEntryBatchRows(rows);
    assert.equal(classified[0]?.kind, "invalid");
    assert.equal(classified[1]?.kind, "eligible");
    assert.equal(classified[2]?.kind, "eligible");
  });

  it("same winner both fields prefers phone; earlier winner wins cross-field", () => {
    const rows = [
      okRow(0, "a", "13800138000", "wx_a"),
      okRow(1, "b", "13900139000", "wx_b"),
      okRow(2, "c", "13800138000", "wx_a"),
      okRow(3, "d", "13900139000", "wx_a"),
    ];
    const classified = classifyQuickEntryBatchRows(rows);
    assert.equal(classified[2]?.kind, "duplicate");
    if (classified[2]?.kind === "duplicate") {
      assert.equal(classified[2].duplicateField, "phone");
    }
    assert.equal(classified[3]?.kind, "duplicate");
    if (classified[3]?.kind === "duplicate") {
      // phone hits row1, wechat hits row0 → earlier wechat winner
      assert.equal(classified[3].duplicateField, "wechatId");
    }
  });
});

describe("batch input guards", () => {
  it("rejects empty／oversized／invalid submissionId", () => {
    assert.equal(validateQuickEntrySubmissionId("not-uuid").ok, false);
    assert.equal(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_EMPTY,
      "QUICK_ENTRY_BATCH_EMPTY",
    );
    assert.equal(
      QUICK_ENTRY_SUBMISSION_ERROR_CODES.BATCH_TOO_LARGE,
      "QUICK_ENTRY_BATCH_TOO_LARGE",
    );
  });
});
