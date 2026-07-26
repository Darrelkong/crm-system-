import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  getIncompleteContactKind,
  MOBILE_BOTTOM_NAV_STACK_OFFSET,
} from "@/lib/customers/incomplete-contact";
import { validateCustomerInput } from "@/lib/customers/validation";
import { createEmptyCustomerCreateFormData } from "@/lib/customers/customer-create-draft";

const PHASE1B_I18N_KEYS = [
  "incompleteWechatTitle",
  "incompleteWechatDescription",
  "incompletePhoneTitle",
  "incompletePhoneDescription",
  "incompleteContactBack",
  "incompleteContactContinue",
  "mobileCreateActionsLabel",
] as const;

const formSource = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/customers/new/new-customer-form.tsx"),
  "utf8",
);
const mobileActionsSource = readFileSync(
  join(
    process.cwd(),
    "src/app/(dashboard)/customers/new/customer-create-mobile-actions.tsx",
  ),
  "utf8",
);
const keyboardHookSource = readFileSync(
  join(
    process.cwd(),
    "src/app/(dashboard)/customers/new/use-mobile-keyboard-open.ts",
  ),
  "utf8",
);
const globalsCss = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);
const navSource = readFileSync(
  join(process.cwd(), "src/components/layout/app-navigation.tsx"),
  "utf8",
);

function validBase(overrides: Record<string, string> = {}) {
  return {
    ...createEmptyCustomerCreateFormData(),
    customerName: "QA Phase1B",
    requestedProjectName: "簽證諮詢服務測試",
    source: "referral",
    notes: "客戶目前需求與辦理目的說明足夠十個字以上",
    ...overrides,
  };
}

describe("customer create Phase 1B incomplete contact flow", () => {
  it("phone+wechat: no incomplete kind; validation passes", () => {
    const form = validBase({ phone: "13800138000", wechatId: "wx_a" });
    assert.equal(getIncompleteContactKind(form.phone, form.wechatId), null);
    const errors = validateCustomerInput(form, {
      requireSalesStage: true,
      allowedSourceKeys: ["referral"],
    });
    assert.equal(errors.length, 0);
  });

  it("phone only: incomplete wechat kind after validation would pass", () => {
    const form = validBase({ phone: "13800138000", wechatId: "" });
    assert.equal(getIncompleteContactKind(form.phone, form.wechatId), "wechat");
    assert.equal(
      validateCustomerInput(form, {
        requireSalesStage: true,
        allowedSourceKeys: ["referral"],
      }).length,
      0,
    );
  });

  it("wechat only: incomplete phone kind after validation would pass", () => {
    const form = validBase({ phone: "", wechatId: "wx_only" });
    assert.equal(getIncompleteContactKind(form.phone, form.wechatId), "phone");
    assert.equal(
      validateCustomerInput(form, {
        requireSalesStage: true,
        allowedSourceKeys: ["referral"],
      }).length,
      0,
    );
  });

  it("neither phone nor wechat: validation fails; incomplete kind is null", () => {
    const form = validBase({ phone: "", wechatId: "", email: "a@b.com" });
    assert.equal(getIncompleteContactKind(form.phone, form.wechatId), null);
    const errors = validateCustomerInput(form, {
      requireSalesStage: true,
      allowedSourceKeys: ["referral"],
    });
    assert.equal(
      errors.some((e) => e.code === "PHONE_OR_WECHAT_REQUIRED"),
      true,
    );
  });

  it("email alone cannot satisfy contact requirement", () => {
    const form = validBase({ phone: "", wechatId: "", email: "only@email.com" });
    assert.equal(
      validateCustomerInput(form, {
        requireSalesStage: true,
        allowedSourceKeys: ["referral"],
      }).some((e) => e.code === "PHONE_OR_WECHAT_REQUIRED"),
      true,
    );
  });

  it("wires incomplete modal before create confirm; does not set submitting early", () => {
    assert.match(formSource, /getIncompleteContactKind/);
    assert.match(formSource, /IncompleteContactConfirmModal/);
    assert.match(formSource, /setShowIncompleteContactModal\(true\)/);
    assert.match(
      formSource,
      /handleIncompleteContactContinue[\s\S]*setShowCreateConfirmModal\(true\)/,
    );
    assert.match(
      formSource,
      /async function submitCreate[\s\S]*setSubmitting\(true\)/,
    );
    assert.doesNotMatch(
      formSource,
      /setShowIncompleteContactModal\(true\)[\s\S]{0,80}setSubmitting\(true\)/,
    );
  });

  it("does not persist incomplete modal state into draft helpers", () => {
    assert.doesNotMatch(formSource, /incompleteContact.*saveCustomerCreateDraft/);
    assert.doesNotMatch(formSource, /showIncompleteContactModal.*localStorage/);
  });

  it("keeps create confirm countdown and on-hold path", () => {
    assert.match(formSource, /CreateCustomerConfirmModal/);
    assert.match(formSource, /salesStage === "on_hold"/);
    const confirmSource = readFileSync(
      join(
        process.cwd(),
        "src/app/(dashboard)/customers/new/create-customer-confirm-modal.tsx",
      ),
      "utf8",
    );
    assert.match(confirmSource, /COUNTDOWN_SECONDS = 5/);
  });
});

describe("customer create Phase 1B mobile fixed actions", () => {
  it("shows fixed actions only below md and hides inline actions on mobile", () => {
    assert.match(mobileActionsSource, /md:hidden/);
    assert.match(formSource, /hidden gap-3 md:flex/);
    assert.match(formSource, /CustomerCreateMobileActions/);
  });

  it("fixed save uses form attribute for the same form id", () => {
    assert.match(formSource, /id=\{NEW_CUSTOMER_FORM_ID\}/);
    assert.match(mobileActionsSource, /form=\{formId\}/);
    assert.match(mobileActionsSource, /type="submit"/);
  });

  it("stacks above MobileBottomNav with matching offset and z-index below modals", () => {
    assert.match(navSource, /z-40/);
    assert.match(navSource, /safe-area-inset-bottom/);
    assert.match(mobileActionsSource, /z-\[45\]/);
    assert.match(MOBILE_BOTTOM_NAV_STACK_OFFSET, /3\.625rem/);
    assert.match(MOBILE_BOTTOM_NAV_STACK_OFFSET, /safe-area-inset-bottom/);
    assert.match(globalsCss, /\.modal-overlay \{[\s\S]*?z-index:\s*50/);
    assert.match(globalsCss, /\.customer-create-mobile-actions/);
    assert.match(globalsCss, /\[data-theme="dark"\] \.customer-create-mobile-actions/);
  });

  it("adds mobile-only bottom padding so content clears the fixed bar", () => {
    assert.match(formSource, /max-md:pb-24/);
  });

  it("draft status stays in the form once (not duplicated in mobile actions)", () => {
    assert.match(formSource, /draftSavedAt/);
    assert.doesNotMatch(mobileActionsSource, /draftSavedAt/);
  });
});

describe("customer create Phase 1B keyboard hook", () => {
  it("guards missing visualViewport and cleans listeners on unmount", () => {
    assert.match(keyboardHookSource, /visualViewport/);
    assert.match(keyboardHookSource, /removeEventListener/);
    assert.match(keyboardHookSource, /matchMedia/);
    assert.match(keyboardHookSource, /max-width: 767px/);
  });

  it("avoids redundant setState loops via prev === next check", () => {
    assert.match(keyboardHookSource, /prev === next \? prev : next/);
  });
});

describe("customer create Phase 1B i18n", () => {
  it("has incomplete-contact keys in all locales", () => {
    for (const key of PHASE1B_I18N_KEYS) {
      assert.equal(typeof en.customers[key], "string", `en ${key}`);
      assert.equal(typeof zhHans.customers[key], "string", `zh-Hans ${key}`);
      assert.equal(typeof zhHant.customers[key], "string", `zh-Hant ${key}`);
    }
  });

  it("English continue label is present for small screens", () => {
    assert.equal(en.customers.incompleteContactContinue, "Confirm and Continue");
    assert.ok(en.customers.incompleteContactContinue.length > 10);
  });
});
