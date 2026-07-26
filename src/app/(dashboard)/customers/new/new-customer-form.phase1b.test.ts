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
  MOBILE_FLOATING_SAVE_BOTTOM,
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
    assert.match(formSource, /postCustomerCreateOnce/);
    assert.match(formSource, /createCustomerCreateSubmitFlight/);
    assert.match(
      formSource,
      /onAcquired:[\s\S]*setSubmitting\(true\)/,
    );
    assert.doesNotMatch(
      formSource,
      /setShowIncompleteContactModal\(true\)[\s\S]{0,80}setSubmitting\(true\)/,
    );
    // Confirm keeps modal open on normal create; only on_hold closes before reason modal.
    const confirmFn = formSource.match(
      /function handleConfirmCreate\(\) \{([\s\S]*?)\n  \}\n\n  return \(/,
    )?.[1];
    assert.ok(confirmFn);
    assert.match(
      confirmFn!,
      /if \(form\.salesStage === "on_hold"\) \{[\s\S]*setShowCreateConfirmModal\(false\);[\s\S]*return;[\s\S]*\}[\s\S]*void submitCreate\(\)/,
    );
    const afterOnHold = confirmFn!.split('void submitCreate()')[0];
    assert.ok(afterOnHold.includes('on_hold'));
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

describe("customer create Phase 1B mobile floating save", () => {
  it("shows floating save only below md and hides inline actions on mobile", () => {
    assert.match(mobileActionsSource, /md:hidden/);
    assert.match(formSource, /hidden gap-3 md:flex/);
    assert.match(formSource, /CustomerCreateMobileActions/);
  });

  it("floating save uses form attribute for the same form id", () => {
    assert.match(formSource, /id=\{NEW_CUSTOMER_FORM_ID\}/);
    assert.match(mobileActionsSource, /form=\{formId\}/);
    assert.match(mobileActionsSource, /type="submit"/);
  });

  it("mobile FAB hides cancel and keeps a single right-aligned save control", () => {
    assert.match(mobileActionsSource, /SHOW_MOBILE_CANCEL_BUTTON = false/);
    assert.match(mobileActionsSource, /justify-end/);
    assert.match(mobileActionsSource, /customer-create-mobile-save/);
    assert.doesNotMatch(mobileActionsSource, /flex-1/);
    assert.match(mobileActionsSource, /min-w-\[7\.5rem\]/);
    assert.match(mobileActionsSource, /px-5/);
    assert.match(mobileActionsSource, /min-h-10/);
    assert.match(mobileActionsSource, /\bh-10\b/);
    assert.match(mobileActionsSource, /size="sm"/);
    assert.match(mobileActionsSource, /pointer-events-none/);
    assert.match(mobileActionsSource, /pointer-events-auto/);
    // Cancel remains easy to restore and desktop cancel stays in the form.
    assert.match(mobileActionsSource, /onClick=\{onCancel\}/);
    assert.match(formSource, /hidden gap-3 md:flex/);
    assert.match(formSource, /t\("common\.cancel"\)/);
    assert.match(formSource, /type="submit"/);
  });

  it("mobile save stays disabled while submitting and FAB unmounts with keyboard", () => {
    assert.match(mobileActionsSource, /disabled=\{submitting\}/);
    assert.match(formSource, /hidden=\{keyboardOpen\}/);
    // Unmount (return null) — do not rely on invisible / opacity hit-testing quirks.
    assert.match(mobileActionsSource, /if \(hidden\) \{\s*return null;/);
    assert.doesNotMatch(mobileActionsSource, /&& ["']invisible["']/);
    assert.doesNotMatch(mobileActionsSource, /className=\{?[^}]*\binvisible\b/);
    assert.doesNotMatch(mobileActionsSource, /aria-hidden=\{hidden\}/);
    assert.doesNotMatch(mobileActionsSource, /opacity-\d/);
    // Hooks run before the early return (Rules of Hooks).
    assert.match(
      mobileActionsSource,
      /const \{ t \} = useTranslation\(\);[\s\S]*if \(hidden\) \{\s*return null;/,
    );
    // Visible shell still click-through; visible button still receives clicks.
    assert.match(mobileActionsSource, /pointer-events-none/);
    assert.match(mobileActionsSource, /pointer-events-auto/);
    // Single FAB region + single save control when rendered.
    assert.equal(
      (mobileActionsSource.match(/customer-create-mobile-actions/g) || [])
        .length,
      1,
    );
    assert.equal(
      (mobileActionsSource.match(/customer-create-mobile-save/g) || []).length,
      1,
    );
    assert.equal(
      (formSource.match(/CustomerCreateMobileActions/g) || []).length,
      2,
    ); // import + JSX
  });

  it("floats above MobileBottomNav with gap and z-index below modals", () => {
    assert.match(navSource, /z-40/);
    assert.match(navSource, /safe-area-inset-bottom/);
    assert.match(mobileActionsSource, /z-\[45\]/);
    assert.match(mobileActionsSource, /MOBILE_FLOATING_SAVE_BOTTOM/);
    assert.match(MOBILE_BOTTOM_NAV_STACK_OFFSET, /3\.625rem/);
    assert.match(MOBILE_BOTTOM_NAV_STACK_OFFSET, /safe-area-inset-bottom/);
    assert.match(MOBILE_FLOATING_SAVE_BOTTOM, /3\.625rem/);
    assert.match(MOBILE_FLOATING_SAVE_BOTTOM, /0\.75rem/);
    assert.match(MOBILE_FLOATING_SAVE_BOTTOM, /safe-area-inset-bottom/);
    assert.match(globalsCss, /\.modal-overlay \{[\s\S]*?z-index:\s*60/);
    assert.match(globalsCss, /\.crm-security-watermark \{[\s\S]*?z-index:\s*55/);
    assert.match(globalsCss, /\.customer-create-mobile-actions/);
    assert.match(
      globalsCss,
      /\.customer-create-mobile-actions \{[\s\S]*?background:\s*transparent/,
    );
    assert.doesNotMatch(
      globalsCss,
      /\.customer-create-mobile-actions \{[\s\S]*?border-top:/,
    );
    assert.doesNotMatch(
      globalsCss,
      /\.customer-create-mobile-actions \{[\s\S]*?backdrop-filter:/,
    );
    assert.match(
      globalsCss,
      /\.customer-create-mobile-save\.primary-button/,
    );
    const modalSource = readFileSync(
      join(process.cwd(), "src/components/ui/modal.tsx"),
      "utf8",
    );
    assert.match(modalSource, /createPortal/);
    assert.match(modalSource, /document\.body/);
    const onHoldSource = readFileSync(
      join(
        process.cwd(),
        "src/app/(dashboard)/customers/new/on-hold-approval-pending-modal.tsx",
      ),
      "utf8",
    );
    assert.match(onHoldSource, /ModalOverlay/);
  });

  it("keeps mobile-only bottom padding so last fields clear the FAB", () => {
    assert.match(formSource, /max-md:pb-16/);
  });

  it("draft status stays in the form once (not duplicated in mobile actions)", () => {
    assert.match(formSource, /draftSavedAt/);
    assert.doesNotMatch(mobileActionsSource, /draftSavedAt/);
  });
});

describe("customer create Phase 1B basic section headings", () => {
  it("does not render identity-and-needs subtitle but keeps contact + fields", () => {
    assert.doesNotMatch(formSource, /identityAndNeedsSection/);
    assert.match(formSource, /customers\.basicSection/);
    assert.match(formSource, /customers\.contactSection/);
    assert.match(formSource, /id="customerType"/);
    assert.match(formSource, /id="customerName"/);
    assert.match(formSource, /id="requestedProjectName"/);
    assert.match(formSource, /CreateCustomerConfirmModal/);
    assert.match(formSource, /IncompleteContactConfirmModal|incomplete-contact/);
    assert.match(formSource, /postCustomerCreateOnce|createCustomerCreateSubmitFlight/);
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
