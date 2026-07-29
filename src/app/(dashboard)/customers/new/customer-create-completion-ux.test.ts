import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  isCustomerCreateDuplicateConflict,
  resolveDuplicateFocusField,
} from "@/app/(dashboard)/customers/new/customer-create-duplicate-alert";
import { getCustomerDisplayName } from "@/lib/customers/customer-display-name";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  assertCanViewCustomerFullDetails,
  getCustomerAccessLevel,
  PermissionError,
} from "@/lib/permissions/customers";
import type { User } from "../../../../../drizzle/schema/users";
import type { Customer } from "../../../../../drizzle/schema/customers";
import { duplicateCustomerConflictResponse } from "@/lib/customers/contact-identifier-conflict";
import {
  createCustomerCreateSubmitFlight,
  postCustomerCreateOnce,
} from "@/lib/customers/customer-create-submit-flight";
import {
  clearCustomerCreateDraft,
  createEmptyCustomerCreateFormData,
  loadCustomerCreateDraft,
  saveCustomerCreateDraft,
} from "@/lib/customers/customer-create-draft";
import { createCustomerCreateDraftAutosave } from "@/lib/customers/customer-create-draft-autosave";

const root = process.cwd();
const formSource = readFileSync(
  join(root, "src/app/(dashboard)/customers/new/new-customer-form.tsx"),
  "utf8",
);
const alertSource = readFileSync(
  join(
    root,
    "src/app/(dashboard)/customers/new/customer-create-duplicate-alert.tsx",
  ),
  "utf8",
);
const createdPageSource = readFileSync(
  join(root, "src/app/(dashboard)/customers/[id]/created/page.tsx"),
  "utf8",
);
const createdClientSource = readFileSync(
  join(
    root,
    "src/app/(dashboard)/customers/[id]/created/customer-created-client.tsx",
  ),
  "utf8",
);
const quickEntryUiSource = readFileSync(
  join(root, "src/app/(dashboard)/public-pool/quick-entry-ui.test.ts"),
  "utf8",
);
const importClientSource = readFileSync(
  join(
    root,
    "src/app/(dashboard)/import/customers/import-customers-client.tsx",
  ),
  "utf8",
);

const I18N_KEYS = [
  "duplicateAlertTitle",
  "duplicateAlertDescription",
  "duplicateMaskedDescription",
  "duplicateGenericEmpty",
  "duplicateEditContact",
  "fieldExists",
  "duplicateAuthorizedSummary",
  "duplicateAuthorizedNameStage",
  "viewExistingClient",
  "createdTitle",
  "createdSubtitle",
  "createdCustomerName",
  "createdRequestedProject",
  "createdAt",
  "createdNotProvided",
  "createdViewDetails",
  "createdAddFollowUp",
  "createdCreateAnother",
  "createdBackToList",
] as const;

function staffUser(id = "staff-1"): User {
  return { id, role: "staff" } as User;
}

function baseCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    customerCode: "C-001",
    customerName: "測試客戶",
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800138000",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectCode: null,
    requestedProjectName: "簽證諮詢",
    salesStage: "new_lead",
    status: "active",
    ownerId: "staff-1",
    notes: null,
    createdAt: "2026-07-01T04:00:00.000Z",
    updatedAt: "2026-07-01T04:00:00.000Z",
    ...overrides,
  } as Customer;
}

describe("customer create completion UX — duplicate helpers", () => {
  it("detects duplicate_customer and DUPLICATE_CUSTOMER on 409", () => {
    assert.equal(
      isCustomerCreateDuplicateConflict(409, { code: "duplicate_customer" }),
      true,
    );
    assert.equal(
      isCustomerCreateDuplicateConflict(409, {
        errorCode: "DUPLICATE_CUSTOMER",
      }),
      true,
    );
    assert.equal(
      isCustomerCreateDuplicateConflict(400, { code: "duplicate_customer" }),
      false,
    );
  });

  it("resolves focus field from phone / wechat / email variants", () => {
    assert.equal(
      resolveDuplicateFocusField([{ field: "phone", customer: { isMasked: true } }]),
      "phone",
    );
    assert.equal(
      resolveDuplicateFocusField([
        { field: "wechat_id", customer: { isMasked: true } },
      ]),
      "wechatId",
    );
    assert.equal(
      resolveDuplicateFocusField([
        { matchedField: "email", field: "phone", customer: { isMasked: true } },
      ]),
      "email",
    );
    assert.equal(resolveDuplicateFocusField([]), null);
  });

  it("duplicate conflict response keeps Phase 1 shape without force-create", async () => {
    const response = duplicateCustomerConflictResponse([
      {
        field: "phone",
        matchedField: "phone",
        customer: {
          isMasked: false,
          id: "c1",
          customerCode: "C-1",
          displayName: "A",
          salesStage: "new_lead",
          href: "/customers/c1",
        },
      },
    ]);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 409);
    assert.equal(body.code, "duplicate_customer");
    assert.equal(body.errorCode, "DUPLICATE_CUSTOMER");
    assert.equal("forceCreate" in body, false);
  });
});

describe("customer create completion UX — form wiring", () => {
  it("closes confirm modal and unlocks flight on duplicate 409", () => {
    assert.match(formSource, /isCustomerCreateDuplicateConflict/);
    assert.match(
      formSource,
      /isCustomerCreateDuplicateConflict[\s\S]*setShowCreateConfirmModal\(false\)/,
    );
    assert.match(
      formSource,
      /isCustomerCreateDuplicateConflict[\s\S]*unlockSubmitFlight\(\)/,
    );
    assert.match(formSource, /CustomerCreateDuplicateAlert/);
    assert.doesNotMatch(formSource, /\bforceCreate\b|強制建立|强制创建/);
  });

  it("uses router.replace to created page after finalizeAccepted", () => {
    assert.match(formSource, /finalizeAcceptedSubmission\(\)/);
    assert.match(
      formSource,
      /router\.replace\(`\/customers\/\$\{data\.id\}\/created`\)/,
    );
    assert.doesNotMatch(
      formSource,
      /router\.push\(`\/customers\/\$\{data\.id\}`\)/,
    );
  });

  it("keeps Pending Approval path on /customers", () => {
    assert.match(formSource, /pendingApproval/);
    assert.match(formSource, /setShowOnHoldSubmittedModal\(true\)/);
    assert.match(formSource, /router\.push\("\/customers"\)/);
  });

  it("duplicate alert is accessible focus/scroll target", () => {
    assert.match(alertSource, /role="alert"/);
    assert.match(alertSource, /aria-live="assertive"/);
    assert.match(alertSource, /tabIndex=\{-1\}/);
    assert.match(formSource, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
    assert.match(formSource, /focus\(\{ preventScroll: true \}\)/);
    assert.match(formSource, /duplicateAlertRef/);
  });

  it("authorized duplicates use backend href; no sensitive contact fields rendered", () => {
    assert.match(alertSource, /href=\{customer\.href\}/);
    assert.doesNotMatch(alertSource, /customer\.phone|customer\.email|customer\.wechat/);
    assert.doesNotMatch(alertSource, /customer\.customerCode/);
    assert.doesNotMatch(alertSource, /EF000\d{3}/);
    assert.doesNotMatch(alertSource, /duplicateAuthorizedSummary/);
    assert.match(alertSource, /duplicateAuthorizedNameStage/);
    assert.match(alertSource, /duplicateMaskedDescription/);
    assert.match(alertSource, /duplicateGenericEmpty/);
  });

  it("does not clear draft on 409 path", () => {
    const marker = "if (isCustomerCreateDuplicateConflict(res.status, data))";
    const start = formSource.indexOf(marker);
    assert.ok(start >= 0);
    const dupBlock = formSource.slice(start, start + 400);
    assert.doesNotMatch(dupBlock, /finalizeAcceptedSubmission/);
    assert.doesNotMatch(dupBlock, /clearCustomerCreateDraft/);
    assert.match(dupBlock, /unlockSubmitFlight\(\)/);
    assert.match(dupBlock, /setShowCreateConfirmModal\(false\)/);
  });
});

describe("customer create completion UX — created page", () => {
  it("server page asserts full details permission", () => {
    assert.match(createdPageSource, /assertCanViewCustomerFullDetails/);
    assert.match(createdPageSource, /errors\.customerNotFound/);
    assert.match(createdPageSource, /errors\.insufficientPermissions/);
    assert.match(createdPageSource, /formatHongKongDateTime/);
    assert.doesNotMatch(createdPageSource, /customerCode/);
  });

  it("omits customerCode from props, UI, and serialized summary", () => {
    assert.doesNotMatch(createdClientSource, /customerCode/);
    assert.doesNotMatch(createdClientSource, /createdCustomerCode/);
    assert.doesNotMatch(createdClientSource, /EF\d{6}|customer-detail-code-value/);
    assert.match(createdClientSource, /createdCustomerName/);
    assert.match(createdClientSource, /createdRequestedProject/);
    assert.match(createdClientSource, /createdAt/);
    assert.equal("createdCustomerCode" in en.customers, false);
    assert.equal("createdCustomerCode" in zhHans.customers, false);
    assert.equal("createdCustomerCode" in zhHant.customers, false);
  });

  it("keeps locked header icon/title/subtitle classes", () => {
    assert.match(
      createdClientSource,
      /flex h-12 w-12 items-center justify-center rounded-full/,
    );
    assert.match(createdClientSource, /Check className="h-6 w-6"/);
    assert.match(
      createdClientSource,
      /<h1 className="page-title mt-4">\{t\("customers\.createdTitle"\)\}<\/h1>/,
    );
    assert.match(
      createdClientSource,
      /<p className="page-description mt-2 max-w-md">/,
    );
  });

  it("client shows four action routes without contact PII", () => {
    assert.match(createdClientSource, /\/customers\/\$\{summary\.customerId\}/);
    assert.match(
      createdClientSource,
      /\/customers\/\$\{summary\.customerId\}\/follow-ups\/new/,
    );
    assert.match(createdClientSource, /href="\/customers\/new"/);
    assert.match(createdClientSource, /href="\/customers"/);
    assert.match(createdClientSource, /getCustomerDisplayName/);
    assert.match(createdClientSource, /resolveRequestedProjectDisplayName/);
    assert.doesNotMatch(
      createdClientSource,
      /\bphone\b|\bwechat\b|\bemail\b|\bnotes\b|sourceRemark|ownerId|assignee/i,
    );
    assert.match(createdClientSource, /max-w-3xl/);
    assert.match(createdClientSource, /grid grid-cols-2 gap-2\.5/);
    assert.match(createdClientSource, /sm:grid-cols-2/);
    assert.match(createdClientSource, /min-w-0/);
    assert.match(createdClientSource, /break-words/);
    assert.match(createdClientSource, /safe-area-inset-bottom/);
    assert.match(createdClientSource, /primary-button|secondary-button|ghost-button/);
    assert.match(createdClientSource, /dark:/);
    assert.match(createdClientSource, /sm:px-8 sm:py-10/);
    assert.match(createdClientSource, /sm:mt-8 sm:gap-3/);
  });

  it("full access allowed; masked/archived_basic/denied blocked", () => {
    const owner = staffUser("staff-1");
    const other = staffUser("staff-2");
    const owned = baseCustomer({ ownerId: "staff-1", status: "active" });
    assert.equal(getCustomerAccessLevel(owner, owned), "full");
    assert.doesNotThrow(() =>
      assertCanViewCustomerFullDetails(owner, owned),
    );

    const pool = baseCustomer({ status: "public_pool", ownerId: null });
    assert.equal(getCustomerAccessLevel(owner, pool), "masked");
    assert.throws(
      () => assertCanViewCustomerFullDetails(owner, pool),
      PermissionError,
    );

    const archivedOwned = baseCustomer({
      status: "archived",
      ownerId: "staff-1",
    });
    assert.equal(getCustomerAccessLevel(owner, archivedOwned), "archived_basic");
    assert.throws(
      () => assertCanViewCustomerFullDetails(owner, archivedOwned),
      PermissionError,
    );

    const denied = baseCustomer({ ownerId: "staff-9", status: "active" });
    assert.equal(getCustomerAccessLevel(other, denied), "denied");
    assert.throws(
      () => assertCanViewCustomerFullDetails(other, denied),
      PermissionError,
    );
  });

  it("pending name and HKT formatting helpers", () => {
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
        customerName: "X先生",
        nameStatus: "pending",
        locale: "zh-Hant",
      }),
      "X先生",
    );
    assert.equal(
      formatHongKongDateTime("2026-07-01T04:00:00.000Z"),
      "2026-07-01 12:00",
    );
  });
});

describe("customer create completion UX — i18n + isolation", () => {
  it("has completion UX keys in all locales", () => {
    for (const key of I18N_KEYS) {
      assert.equal(typeof en.customers[key], "string", `en ${key}`);
      assert.equal(typeof zhHans.customers[key], "string", `zh-Hans ${key}`);
      assert.equal(typeof zhHant.customers[key], "string", `zh-Hant ${key}`);
    }
  });

  it("Quick Entry / Import sources unchanged by this feature surface", () => {
    assert.doesNotMatch(formSource, /quick-entry|QuickEntry/);
    assert.ok(quickEntryUiSource.length > 0);
    assert.ok(importClientSource.length > 0);
    assert.doesNotMatch(createdPageSource, /quick-entry|QuickEntry|\/import\//);
  });
});

describe("customer create completion UX — draft / flight regression", () => {
  it("409 unlock preserves draft; success finalizeAccepted clears draft", async () => {
    const userId = "ux-completion-user";
    const memory = new Map<string, string>();
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
        setItem: (k: string, v: string) => {
          memory.set(k, v);
        },
        removeItem: (k: string) => {
          memory.delete(k);
        },
        clear: () => memory.clear(),
        key: (i: number) => [...memory.keys()][i] ?? null,
        get length() {
          return memory.size;
        },
      } satisfies Storage,
    });

    try {
      clearCustomerCreateDraft(userId);
      const form = {
        ...createEmptyCustomerCreateFormData(),
        customerName: "QA UX",
        requestedProjectName: "Visa",
        phone: "13800138000",
        wechatId: "wx",
        source: "referral",
        notes: "首次溝通說明超過十個字以上內容",
        salesStage: "new_lead",
      };
      saveCustomerCreateDraft(userId, form);

      const flight = createCustomerCreateSubmitFlight();
      const dup = await postCustomerCreateOnce({
        flight,
        body: form,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ code: "duplicate_customer", duplicates: [] }),
            { status: 409 },
          ),
      });
      assert.equal(dup.status, "response");
      flight.release();
      assert.equal(flight.isInFlight(), false);
      assert.ok(loadCustomerCreateDraft(userId).ok);

      const autosave = createCustomerCreateDraftAutosave({
        onPersisted: () => {},
      });
      autosave.setReady(true);
      const ok = await postCustomerCreateOnce({
        flight,
        body: form,
        fetchImpl: async () =>
          new Response(JSON.stringify({ ok: true, id: "new-id" }), {
            status: 201,
          }),
      });
      assert.equal(ok.status, "response");
      autosave.finalizeAccepted(userId);
      assert.equal(loadCustomerCreateDraft(userId).ok, false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      });
    }
  });
});
