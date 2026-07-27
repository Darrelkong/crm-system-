import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveCustomerNameLabelModel } from "@/lib/customers/customer-name-label";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

describe("resolveCustomerNameLabelModel", () => {
  it("confirmed Chinese name: no pending badge", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "張三",
      nameStatus: "confirmed",
      locale: "zh-Hant",
    });
    assert.equal(model.displayName, "張三");
    assert.equal(model.showPendingBadge, false);
  });

  it("confirmed English name: no pending badge", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "Alice Chen",
      nameStatus: "confirmed",
      locale: "en",
    });
    assert.equal(model.displayName, "Alice Chen");
    assert.equal(model.showPendingBadge, false);
  });

  it("pending X先生 traditional: shows X先生 + badge", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "X先生",
      nameStatus: "pending",
      locale: "zh-Hant",
    });
    assert.equal(model.displayName, "X先生");
    assert.equal(model.showPendingBadge, true);
  });

  it("pending X女士 traditional: shows X女士 + badge", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "X女士",
      nameStatus: "pending",
      locale: "zh-Hant",
    });
    assert.equal(model.displayName, "X女士");
    assert.equal(model.showPendingBadge, true);
  });

  it("pending X先生 simplified locale: shows X先生 + badge", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "X先生",
      nameStatus: "pending",
      locale: "zh-Hans",
    });
    assert.equal(model.displayName, "X先生");
    assert.equal(model.showPendingBadge, true);
  });

  it("pending X女士 simplified locale: shows X女士 + badge", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "X女士",
      nameStatus: "pending",
      locale: "zh-Hans",
    });
    assert.equal(model.displayName, "X女士");
    assert.equal(model.showPendingBadge, true);
  });

  it("pending X先生 English: shows Mr. X + badge", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "X先生",
      nameStatus: "pending",
      locale: "en",
    });
    assert.equal(model.displayName, "Mr. X");
    assert.equal(model.showPendingBadge, true);
  });

  it("pending X女士 English: shows Ms. X + badge", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "X女士",
      nameStatus: "pending",
      locale: "en",
    });
    assert.equal(model.displayName, "Ms. X");
    assert.equal(model.showPendingBadge, true);
  });

  it("showPendingBadge false suppresses badge even when pending", () => {
    const model = resolveCustomerNameLabelModel({
      customerName: "X先生",
      nameStatus: "pending",
      locale: "zh-Hant",
      showPendingBadge: false,
    });
    assert.equal(model.displayName, "X先生");
    assert.equal(model.showPendingBadge, false);
  });
});

describe("namePendingBadge i18n parity", () => {
  it("keeps localized pending badge copy in all locales", () => {
    assert.equal(zhHant.customers.namePendingBadge, "姓名待確認");
    assert.equal(zhHans.customers.namePendingBadge, "姓名待确认");
    assert.equal(en.customers.namePendingBadge, "Name pending confirmation");
  });
});

describe("CustomerNameLabel component source", () => {
  const componentSource = readFileSync(
    join(process.cwd(), "src/components/customers/customer-name-label.tsx"),
    "utf8",
  );
  const modelSource = readFileSync(
    join(process.cwd(), "src/lib/customers/customer-name-label.ts"),
    "utf8",
  );

  it("uses getCustomerDisplayName via resolveCustomerNameLabelModel", () => {
    assert.match(modelSource, /getCustomerDisplayName/);
    assert.match(componentSource, /resolveCustomerNameLabelModel/);
    assert.doesNotMatch(componentSource, /"use client"/);
    assert.doesNotMatch(componentSource, /useTranslation/);
  });

  it("reuses subdued badge styling token", () => {
    assert.match(componentSource, /CUSTOMER_NAME_PENDING_BADGE_CLASS/);
    assert.match(componentSource, /bg-transparent text-\[#6B7890\]/);
  });
});
