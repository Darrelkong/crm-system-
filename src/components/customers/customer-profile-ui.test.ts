import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import en from "@/i18n/locales/en";
import zhHant from "@/i18n/locales/zh-Hant";
import zhHans from "@/i18n/locales/zh-Hans";
import {
  createEmptyCustomerCreateFormData,
  normalizeCustomerCreateDraftForm,
  isCustomerCreateDraftMeaningful,
} from "@/lib/customers/customer-create-draft";
import { shouldExpandCustomerProfileSection } from "@/components/customers/customer-profile-section";

describe("customer profile draft + form section", () => {
  it("restores legacy drafts without profile keys", () => {
    const form = normalizeCustomerCreateDraftForm({
      customerName: "測試",
      customerType: "individual",
      phoneCountryCode: "+86",
      phone: "13800138000",
      wechatId: "",
      email: "",
      source: "referral",
      sourceRemark: "",
      salesStage: "new_lead",
      notes: "首次溝通備註內容足夠",
    });
    assert.equal(form.preferredName, "");
    assert.equal(form.gender, "");
    assert.equal(form.primaryConcern, "");
    assert.equal(isCustomerCreateDraftMeaningful(form), true);
  });

  it("treats profile-only drafts as meaningful and expandable", () => {
    const form = createEmptyCustomerCreateFormData();
    form.preferredName = "阿明";
    assert.equal(isCustomerCreateDraftMeaningful(form), true);
    assert.equal(shouldExpandCustomerProfileSection(form), true);
  });

  it("keeps blank create profile collapsed by default", () => {
    const form = createEmptyCustomerCreateFormData();
    assert.equal(shouldExpandCustomerProfileSection(form), false);
  });

  it("wires create form after source card and before desktop save", () => {
    const src = readFileSync(
      "src/app/(dashboard)/customers/new/new-customer-form.tsx",
      "utf8",
    );
    const sourceIdx = src.indexOf('t("customers.sourceAndStage")');
    const profileIdx = src.indexOf("<CustomerProfileSection");
    const saveIdx = src.indexOf('t("customers.saveClient")');
    assert.ok(sourceIdx > 0);
    assert.ok(profileIdx > sourceIdx);
    assert.ok(saveIdx > profileIdx);
    assert.match(src, /initiallyExpanded=\{profileInitiallyExpanded\}/);
    assert.match(src, /CustomerProfileSection/);
  });

  it("section uses type=button and aria-expanded", () => {
    const src = readFileSync(
      "src/components/customers/customer-profile-section.tsx",
      "utf8",
    );
    assert.match(src, /type="button"/);
    assert.match(src, /aria-expanded=\{open\}/);
    assert.match(src, /aria-controls=\{panelId\}/);
  });
});

describe("customer profile fields mobile compact UI", () => {
  const fieldsSrc = readFileSync(
    "src/components/customers/customer-profile-fields.tsx",
    "utf8",
  );

  it("uses mobile 2-col grid with desktop 3-col and full-width long fields", () => {
    assert.match(fieldsSrc, /grid-cols-2/);
    assert.match(fieldsSrc, /lg:grid-cols-3/);
    assert.match(fieldsSrc, /col-span-2 md:col-span-1/);
    assert.match(fieldsSrc, /col-span-2 lg:col-span-3/);
    assert.match(fieldsSrc, /min-w-0/);
    assert.match(fieldsSrc, /gap-x-2\.5/);
  });

  it("keeps empty select option value blank and uses please-select label", () => {
    assert.match(fieldsSrc, /<option value="">\{t\("customers\.profilePleaseSelect"\)\}<\/option>/);
    assert.doesNotMatch(fieldsSrc, /profileSelectOptional/);
    assert.doesNotMatch(fieldsSrc, /選填|选填|\(Optional\)/);
  });

  it("keeps select empty value as empty string only", () => {
    assert.match(
      fieldsSrc,
      /<option value="">\{t\("customers\.profilePleaseSelect"\)\}<\/option>/,
    );
    assert.equal((fieldsSrc.match(/profilePleaseSelect/g) ?? []).length, 4);
  });
});

describe("customer profile placeholder i18n", () => {
  it("removes optional wording from field placeholders and aligns locales", () => {
    assert.equal(zhHant.customers.profilePleaseSelect, "請選擇");
    assert.equal(zhHans.customers.profilePleaseSelect, "请选择");
    assert.equal(en.customers.profilePleaseSelect, "Please select");

    assert.equal(zhHant.customers.preferredNamePlaceholder, "請輸入稱呼");
    assert.equal(zhHans.customers.preferredNamePlaceholder, "请输入称呼");
    assert.equal(en.customers.preferredNamePlaceholder, "Enter preferred name");

    assert.equal(zhHant.customers.occupationPlaceholder, "請輸入職業");
    assert.equal(zhHans.customers.occupationPlaceholder, "请输入职业");
    assert.equal(en.customers.occupationPlaceholder, "Enter occupation");

    assert.equal(zhHant.customers.companyNamePlaceholder, "請輸入公司名稱");
    assert.equal(zhHans.customers.companyNamePlaceholder, "请输入公司名称");
    assert.equal(en.customers.companyNamePlaceholder, "Enter company name");

    assert.equal(zhHant.customers.jobTitlePlaceholder, "請輸入職位");
    assert.equal(zhHans.customers.jobTitlePlaceholder, "请输入职位");
    assert.equal(en.customers.jobTitlePlaceholder, "Enter job title");

    assert.equal(
      zhHant.customers.targetCountryOrRegionPlaceholder,
      "請輸入目標國家或地區",
    );
    assert.equal(
      zhHans.customers.targetCountryOrRegionPlaceholder,
      "请输入目标国家或地区",
    );
    assert.equal(
      en.customers.targetCountryOrRegionPlaceholder,
      "Enter target country or region",
    );

    assert.equal(
      zhHant.customers.primaryConcernPlaceholder,
      "例如：目前最關注的問題、顧慮或辦理障礙",
    );
    assert.equal(
      zhHans.customers.primaryConcernPlaceholder,
      "例如：目前最关注的问题、顾虑或办理障碍",
    );
    assert.equal(
      en.customers.primaryConcernPlaceholder,
      "For example: key concerns, questions, or current obstacles",
    );

    assert.match(zhHant.customers.moreCustomerDataSubtitle, /選填/);
    assert.match(zhHans.customers.moreCustomerDataSubtitle, /选填/);
    assert.match(en.customers.moreCustomerDataSubtitle, /Optional/);

    for (const locale of [zhHant, zhHans, en] as const) {
      assert.equal(
        "profileSelectOptional" in locale.customers,
        false,
        "legacy optional key must be removed",
      );
    }
  });
});
