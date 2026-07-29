import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  isCustomerCreateDuplicateConflict,
  isCustomerCreateNameDuplicateWarning,
} from "@/app/(dashboard)/customers/new/customer-create-duplicate-alert";
import { duplicateCustomerNameConflictResponse } from "@/lib/customers/name-duplicate-check";
import { normalizeCustomerNameForDuplicateMatch } from "@/lib/customers/name-duplicate";

const root = process.cwd();
const routeSource = readFileSync(
  join(root, "src/app/api/customers/route.ts"),
  "utf8",
);
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
const createdClientSource = readFileSync(
  join(
    root,
    "src/app/(dashboard)/customers/[id]/created/customer-created-client.tsx",
  ),
  "utf8",
);
const editFormSource = readFileSync(
  join(
    root,
    "src/app/(dashboard)/customers/[id]/edit/edit-customer-form.tsx",
  ),
  "utf8",
);
const qeTestSource = readFileSync(
  join(root, "src/app/(dashboard)/public-pool/quick-entry-ui.test.ts"),
  "utf8",
);

const NAME_I18N_KEYS = [
  "duplicateNameAlertTitle",
  "duplicateNameAlertDescription",
  "duplicateNameMaskedDescription",
  "duplicateNameEditName",
  "duplicateNameConfirmContinue",
  "duplicateNameConfirming",
  "duplicateNameField",
] as const;

describe("customer name duplicate warning — API wiring", () => {
  it("runs contact hard check before name soft warning", () => {
    const hardIdx = routeSource.indexOf("checkCustomerDuplicates");
    const nameIdx = routeSource.indexOf("checkCustomerNameDuplicates");
    assert.ok(hardIdx > 0);
    assert.ok(nameIdx > hardIdx);
  });

  it("ignores confirmDuplicateName when contact hard duplicates exist", () => {
    const hardBlock = routeSource.slice(
      routeSource.indexOf("if (duplicates.length > 0)"),
      routeSource.indexOf("const nameStatus ="),
    );
    assert.match(hardBlock, /duplicate_customer/);
    assert.doesNotMatch(hardBlock, /confirmDuplicateName/);
  });

  it("skips name check for pending nameStatus", () => {
    assert.match(
      routeSource,
      /if \(nameStatus === "confirmed"\)[\s\S]*checkCustomerNameDuplicates/,
    );
  });

  it("requires confirmDuplicateName to equal server normalizedName", () => {
    assert.match(routeSource, /parseConfirmDuplicateName/);
    assert.match(routeSource, /confirm !== normalizedName/);
    assert.match(routeSource, /duplicateCustomerNameConflictResponse/);
  });

  it("keeps D1 unique race hard mapper unchanged", () => {
    assert.match(routeSource, /resolveIdentifierConstraintAsDuplicates/);
    assert.match(routeSource, /duplicateCustomerConflictResponse/);
  });

  it("stores only boolean audit flag on successful confirmed create", () => {
    assert.match(
      routeSource,
      /duplicateNameWarningConfirmed:\s*true/,
    );
    assert.doesNotMatch(
      routeSource,
      /duplicateNameWarningConfirmed:[\s\S]{0,40}normalizedName/,
    );
  });

  it("does not change success response shape", () => {
    assert.match(routeSource, /\{ ok: true, id \}/);
  });
});

describe("customer name duplicate warning — response + detectors", () => {
  it("returns 409 duplicate_customer_name without code/id/contact", async () => {
    const response = duplicateCustomerNameConflictResponse({
      normalizedName: "王小明",
      duplicates: [
        {
          field: "name",
          matchedField: "name",
          customer: {
            isMasked: false,
            displayName: "王小明",
            salesStage: "new_lead",
            href: "/customers/abc",
          },
        },
        {
          field: "name",
          matchedField: "name",
          customer: { isMasked: true },
        },
      ],
    });
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 409);
    assert.equal(body.code, "duplicate_customer_name");
    assert.equal(body.errorCode, "DUPLICATE_CUSTOMER_NAME");
    assert.equal(body.normalizedName, "王小明");
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /customerCode|EF000|"id":/);
    assert.doesNotMatch(serialized, /phone|wechat|email/i);
  });

  it("distinguishes hard vs soft detectors", () => {
    assert.equal(
      isCustomerCreateDuplicateConflict(409, { code: "duplicate_customer" }),
      true,
    );
    assert.equal(
      isCustomerCreateNameDuplicateWarning(409, {
        code: "duplicate_customer_name",
      }),
      true,
    );
    assert.equal(
      isCustomerCreateDuplicateConflict(409, {
        code: "duplicate_customer_name",
      }),
      false,
    );
    assert.equal(
      isCustomerCreateNameDuplicateWarning(409, {
        code: "duplicate_customer",
      }),
      false,
    );
  });
});

describe("customer name duplicate warning — UI wiring", () => {
  it("closes confirm modal and unlocks on name warning", () => {
    assert.match(formSource, /isCustomerCreateNameDuplicateWarning/);
    assert.match(
      formSource,
      /isCustomerCreateNameDuplicateWarning[\s\S]*setShowCreateConfirmModal\(false\)/,
    );
    assert.match(
      formSource,
      /isCustomerCreateNameDuplicateWarning[\s\S]*unlockSubmitFlight\(\)/,
    );
  });

  it("confirm continue posts confirmDuplicateName without reopening confirm modal", () => {
    assert.match(formSource, /handleConfirmNameContinue/);
    assert.match(
      formSource,
      /confirmDuplicateName:\s*nameDuplicateWarning\.normalizedName/,
    );
    assert.match(formSource, /name-soft-warning/);
    assert.match(alertSource, /duplicateNameConfirmContinue/);
    assert.doesNotMatch(alertSource, /customer\.customerCode/);
    assert.doesNotMatch(alertSource, /amber-/);
    assert.match(alertSource, /border-l-blue-700/);
    assert.match(alertSource, /border-l-rose-700/);
  });

  it("clears name warning when customerName changes", () => {
    assert.match(
      formSource,
      /field === "customerName" \|\| field === "nameStatus"/,
    );
    assert.match(formSource, /setNameDuplicateWarning\(null\)/);
  });

  it("switches to hard alert when second submit returns contact duplicate", () => {
    assert.match(
      formSource,
      /isCustomerCreateDuplicateConflict[\s\S]*setNameDuplicateWarning\(null\)/,
    );
  });

  it("keeps Pending Approval and created replace paths", () => {
    assert.match(formSource, /pendingApproval/);
    assert.match(
      formSource,
      /router\.replace\(`\/customers\/\$\{data\.id\}\/created`\)/,
    );
  });

  it("does not put confirmDuplicateName into draft helpers", () => {
    assert.doesNotMatch(formSource, /confirmDuplicateName[\s\S]{0,80}draft/i);
    assert.doesNotMatch(
      formSource,
      /saveCustomerCreateDraft\([\s\S]*confirmDuplicateName/,
    );
  });

  it("leaves Quick Entry / Import / Edit / created page untouched by name soft flow", () => {
    assert.doesNotMatch(editFormSource, /duplicate_customer_name/);
    assert.doesNotMatch(createdClientSource, /duplicate_customer_name/);
    assert.ok(qeTestSource.length > 0);
    assert.equal(
      normalizeCustomerNameForDuplicateMatch("X先生"),
      null,
    );
  });
});

describe("customer name duplicate warning — i18n", () => {
  it("has soft-warning keys in all locales", () => {
    for (const key of NAME_I18N_KEYS) {
      assert.equal(typeof en.customers[key], "string", `en ${key}`);
      assert.equal(typeof zhHans.customers[key], "string", `zh-Hans ${key}`);
      assert.equal(typeof zhHant.customers[key], "string", `zh-Hant ${key}`);
    }
  });
});
