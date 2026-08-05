import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CUSTOMER_NAME_STATUSES,
  PENDING_NAME_PLACEHOLDERS,
  isCustomerNameStatus,
  isPendingNamePlaceholder,
  normalizeCustomerNameStatus,
} from "@/lib/customers/name-status";
import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";
import { validateCustomerInput } from "@/lib/customers/validation";
import { normalizeCustomerCreateDraftForm } from "@/lib/customers/customer-create-draft";
import { customerNameIsSearchableByStatus } from "@/lib/customers/queries";
import { computeCustomerInsightSourceHash } from "@/lib/ai/customer-insights/hash";
import type { CustomerInsightContext } from "@/lib/ai/customer-insights/context-builder";
import { sanitizeCustomerInsightContextForProvider } from "@/lib/ai/customer-insights/context-sanitize";
import { mockCustomerInsightProvider } from "@/lib/ai/providers/mock";
import type { CustomerInsightOutput } from "@/lib/ai/customer-insights/schema";
import type { EffectiveAiSettings } from "@/lib/settings/ai-effective";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import "./confirm-name.test";
import "./search-like-escape.test";
import "./customer-name-label.test";
import "./pending-name-authorized-views.test";
import "./pending-name-admin-views.test";
import "../export/customers/optional-name-status.test";

const newCustomerFormSource = readFileSync(
  join(process.cwd(), "src/app/(dashboard)/customers/new/new-customer-form.tsx"),
  "utf8",
);

describe("customer name status helpers", () => {
  it("exposes confirmed and pending only", () => {
    assert.deepEqual([...CUSTOMER_NAME_STATUSES], ["confirmed", "pending"]);
    assert.deepEqual([...PENDING_NAME_PLACEHOLDERS], ["X先生", "X女士"]);
  });

  it("validates status and placeholders", () => {
    assert.equal(isCustomerNameStatus("confirmed"), true);
    assert.equal(isCustomerNameStatus("pending"), true);
    assert.equal(isCustomerNameStatus("other"), false);
    assert.equal(isPendingNamePlaceholder("X先生"), true);
    assert.equal(isPendingNamePlaceholder("Mr. X"), false);
    assert.equal(isPendingNamePlaceholder("x先生"), false);
    assert.equal(normalizeCustomerNameStatus(undefined), "confirmed");
  });
});

describe("getCustomerDisplayName", () => {
  it("returns real name when confirmed", () => {
    assert.equal(
      getCustomerDisplayName({
        customerName: "張三",
        nameStatus: "confirmed",
        locale: "en",
      }),
      "張三",
    );
  });

  it("localizes pending placeholders", () => {
    assert.equal(
      getCustomerDisplayName({
        customerName: "X先生",
        nameStatus: "pending",
        locale: "en",
      }),
      "Mr. X",
    );
    assert.equal(
      getCustomerDisplayName({
        customerName: "X女士",
        nameStatus: "pending",
        locale: "zh-Hant",
      }),
      "X女士",
    );
  });
});

describe("create nameStatus validation", () => {
  const base = {
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800138000",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectCode: "hk_bank_account",
    requestedProjectName: "",
    notes: "首次溝通備註超過十字即可",
    salesStage: "new_lead",
    status: "active",
  };

  it("defaults confirmed real name", () => {
    const errors = validateCustomerInput(
      { ...base, customerName: "王小明", nameStatus: "confirmed" },
      { requireSalesStage: true, enforceCreateNameStatusRules: true },
    );
    assert.equal(errors.length, 0);
  });

  it("allows pending X先生 / X女士", () => {
    assert.equal(
      validateCustomerInput(
        { ...base, customerName: "X先生", nameStatus: "pending" },
        { enforceCreateNameStatusRules: true, requireSalesStage: true },
      ).length,
      0,
    );
    assert.equal(
      validateCustomerInput(
        { ...base, customerName: "X女士", nameStatus: "pending" },
        { enforceCreateNameStatusRules: true, requireSalesStage: true },
      ).length,
      0,
    );
  });

  it("rejects pending without placeholder and Mr. X", () => {
    assert.ok(
      validateCustomerInput(
        { ...base, customerName: "", nameStatus: "pending" },
        { enforceCreateNameStatusRules: true, requireSalesStage: true },
      ).some((e) => e.code === "PENDING_NAME_REQUIRED"),
    );
    assert.ok(
      validateCustomerInput(
        { ...base, customerName: "Mr. X", nameStatus: "pending" },
        { enforceCreateNameStatusRules: true, requireSalesStage: true },
      ).some((e) => e.code === "INVALID_PENDING_NAME_PLACEHOLDER"),
    );
  });

  it("rejects confirmed placeholder names", () => {
    assert.ok(
      validateCustomerInput(
        { ...base, customerName: "X先生", nameStatus: "confirmed" },
        { enforceCreateNameStatusRules: true, requireSalesStage: true },
      ).some((e) => e.code === "CONFIRMED_PLACEHOLDER_FORBIDDEN"),
    );
  });

  it("rejects illegal enum", () => {
    assert.ok(
      validateCustomerInput(
        {
          ...base,
          customerName: "王小明",
          nameStatus: "weird" as "confirmed",
        },
        { enforceCreateNameStatusRules: true, requireSalesStage: true },
      ).some((e) => e.code === "INVALID_NAME_STATUS"),
    );
  });
});

describe("draft nameStatus normalize", () => {
  it("defaults missing status to confirmed", () => {
    const form = normalizeCustomerCreateDraftForm({
      customerName: "李四",
      requestedProjectName: "項目",
    });
    assert.equal(form.nameStatus, "confirmed");
    assert.equal(form.customerName, "李四");
  });

  it("keeps valid pending placeholders", () => {
    const form = normalizeCustomerCreateDraftForm({
      customerName: "X先生",
      nameStatus: "pending",
    });
    assert.equal(form.nameStatus, "pending");
    assert.equal(form.customerName, "X先生");
  });

  it("downgrades illegal pending", () => {
    const form = normalizeCustomerCreateDraftForm({
      customerName: "隨便",
      nameStatus: "pending",
    });
    assert.equal(form.nameStatus, "confirmed");
    assert.equal(form.customerName, "");
  });
});

describe("name search excludes pending", () => {
  it("only confirmed names are searchable by customerName", () => {
    assert.equal(customerNameIsSearchableByStatus("confirmed"), true);
    assert.equal(customerNameIsSearchableByStatus("pending"), false);
    assert.equal(customerNameIsSearchableByStatus(undefined), false);
  });
});

describe("AI context pending safety", () => {
  function baseContext(
    overrides: Partial<CustomerInsightContext> = {},
  ): CustomerInsightContext {
    return {
      customerId: "c-pending",
      customerName: "王小明",
      nameStatus: "confirmed",
      customerType: "individual",
      salesStage: "lead",
      source: "web",
      status: "active",
      requestedProjectName: null,
      sourceRemark: null,
      notes: null,
      lastFollowUpAt: null,
      lastValidFollowUpAt: null,
      nextFollowUpAt: null,
      updatedAt: "2026-07-20T00:00:00.000Z",
      includeSensitiveFields: true,
      phone: null,
      wechatId: null,
      email: null,
      recentFollowUps: [],
      ...overrides,
    };
  }

  it("keeps confirmed name and status through sanitize", () => {
    const sanitized = sanitizeCustomerInsightContextForProvider(baseContext());
    assert.equal(sanitized.customerName, "王小明");
    assert.equal(sanitized.nameStatus, "confirmed");
  });

  it("pending context uses null customerName and keeps nameStatus", () => {
    const sanitized = sanitizeCustomerInsightContextForProvider(
      baseContext({ customerName: null, nameStatus: "pending" }),
    );
    assert.equal(sanitized.customerName, null);
    assert.equal(sanitized.nameStatus, "pending");
    assert.equal(JSON.stringify(sanitized).includes("X先生"), false);
  });

  it("hash differs between pending and confirmed", async () => {
    const confirmed = await computeCustomerInsightSourceHash(
      baseContext({ customerName: "王小明", nameStatus: "confirmed" }),
    );
    const pending = await computeCustomerInsightSourceHash(
      baseContext({ customerName: null, nameStatus: "pending" }),
    );
    assert.notEqual(confirmed, pending);
  });

  it("mock provider does not address pending as X先生", async () => {
    const result = (await mockCustomerInsightProvider.analyzeCustomerInsight(
      baseContext({ customerName: null, nameStatus: "pending" }),
      { aiAnalysisLanguage: "zh-Hant" } as EffectiveAiSettings,
    )) as CustomerInsightOutput;
    assert.equal(result.customerSummary.includes("X先生"), false);
    assert.equal(result.customerSummary.includes("真實姓名待確認"), true);
  });
});

describe("i18n pending name keys", () => {
  const keys = [
    "nameUnknownToggle",
    "pendingNameMr",
    "pendingNameMs",
    "pendingNameMrEnLabel",
    "pendingNameMsEnLabel",
    "namePendingBadge",
  ] as const;

  it("keeps customer copy keys in all locales", () => {
    for (const key of keys) {
      assert.equal(typeof en.customers[key], "string", `en ${key}`);
      assert.equal(typeof zhHans.customers[key], "string", `zh-Hans ${key}`);
      assert.equal(typeof zhHant.customers[key], "string", `zh-Hant ${key}`);
    }
    assert.equal(zhHant.customers.nameUnknownToggle, "暫時不知道姓名");
    assert.equal(zhHans.customers.nameUnknownToggle, "暂时不知道姓名");
    assert.equal(en.customers.nameUnknownToggle, "Name not known yet");
    assert.equal(en.customers.pendingNameMrEnLabel, "Mr. X");
    assert.equal(en.customers.pendingNameMsEnLabel, "Ms. X");
    assert.equal(zhHant.customers.namePendingBadge, "姓名待確認");
  });
});

describe("pending name create form UI polish", () => {
  it("keeps label and short toggle in a shared field header", () => {
    assert.match(newCustomerFormSource, /justify-between/);
    assert.match(newCustomerFormSource, /customers\.nameUnknownToggle/);
    assert.match(newCustomerFormSource, /type="checkbox"/);
  });

  it("shows Input only when confirmed and segmented radios when pending", () => {
    assert.match(newCustomerFormSource, /form\.nameStatus === "pending"/);
    assert.match(newCustomerFormSource, /role="radiogroup"/);
    assert.match(newCustomerFormSource, /grid grid-cols-2/);
    assert.match(newCustomerFormSource, /surface-input/);
    assert.match(newCustomerFormSource, /min-h-11/);
    assert.match(newCustomerFormSource, /className="sr-only"/);
    assert.match(newCustomerFormSource, /type="radio"/);
    assert.match(
      newCustomerFormSource,
      /form\.nameStatus === "pending" \? \([\s\S]*radiogroup[\s\S]*\) : \([\s\S]*<Input/,
    );
  });

  it("clears placeholder when toggling pending off and restores blank Input path", () => {
    assert.match(
      newCustomerFormSource,
      /nameStatus:\s*"confirmed",\s*customerName:\s*""/,
    );
    assert.match(
      newCustomerFormSource,
      /nameStatus:\s*"pending",\s*customerName:\s*""/,
    );
  });

  it("uses English labels but keeps canonical radio values", () => {
    assert.match(newCustomerFormSource, /pendingNameMrEnLabel/);
    assert.match(newCustomerFormSource, /pendingNameMsEnLabel/);
    assert.match(newCustomerFormSource, /PENDING_NAME_PLACEHOLDERS\.map/);
    assert.match(newCustomerFormSource, /value=\{placeholder\}/);
    assert.deepEqual([...PENDING_NAME_PLACEHOLDERS], ["X先生", "X女士"]);
  });

  it("keeps accessibility wiring for segmented radios", () => {
    assert.match(newCustomerFormSource, /htmlFor=\{optionId\}/);
    assert.match(newCustomerFormSource, /id=\{optionId\}/);
    assert.match(newCustomerFormSource, /pending-name-\$\{placeholder\}/);
    assert.match(newCustomerFormSource, /aria-label=\{t\("customers\.clientName"\)\}/);
  });

  it("surfaces pending validation under the selector with error ring", () => {
    assert.match(newCustomerFormSource, /fieldErrors\.customerName/);
    assert.match(newCustomerFormSource, /fieldErrors\.nameStatus/);
    assert.match(newCustomerFormSource, /ring-red-500/);
  });
});
