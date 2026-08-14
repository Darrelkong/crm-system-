import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_AGE_RANGES,
  CUSTOMER_GENDERS,
  CUSTOMER_PREFERRED_CONTACT_METHODS,
  CUSTOMER_PREFERRED_LANGUAGES,
  CUSTOMER_PROFILE_DB_FIELD_NAMES,
  CUSTOMER_PROFILE_FIELD_KEYS,
  normalizeCustomerProfileFields,
  validateCustomerProfileFields,
} from "./customer-profile";
import { validateCustomerInput } from "./validation";
import { calculateDataCompletenessScore } from "./scoring/completeness";
import type { Customer } from "../../../drizzle/schema/customers";
import { maskCustomerForStaff, toCustomerFullView } from "@/lib/permissions/customers";
import { formatStaffPublicPoolCustomer } from "@/lib/public-pool/queries";

const BASE_INPUT = {
  customerName: "张三测试",
  customerType: "individual",
  phoneCountryCode: "+86",
  phone: "13800138000",
  wechatId: "",
  email: "",
  source: "referral",
  sourceRemark: "",
  requestedProjectCode: "hk_bank_account",
  requestedProjectName: "网站开发项目",
  notes: "客户当前处于初步沟通阶段，需要进一步跟进确认需求。",
  salesStage: "new_lead",
  status: "active",
};

function baseCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    customerCode: "EF000001",
    customerName: "測試客戶",
    nameStatus: "confirmed",
    customerType: "individual",
    phoneCountryCode: "+86",
    phone: "13800138000",
    wechatId: null,
    email: null,
    source: "referral",
    sourceRemark: null,
    requestedProjectName: null,
    requestedProjectCode: null,
    notes: "首次溝通備註內容足夠長度",
    preferredName: null,
    gender: null,
    ageRange: null,
    preferredLanguage: null,
    preferredContactMethod: null,
    occupation: null,
    companyName: null,
    jobTitle: null,
    targetCountryOrRegion: null,
    primaryConcern: null,
    salesStage: "new_lead",
    ownerId: "owner-1",
    status: "active",
    releaserUserId: null,
    poolEnteredAt: null,
    poolReason: null,
    releasedBy: null,
    previousOwnerId: null,
    claimedBy: null,
    claimedAt: null,
    poolLeftAt: null,
    createdBy: "owner-1",
    updatedBy: null,
    lastFollowUpAt: null,
    lastValidFollowUpAt: null,
    reclamationCycleStartedAt: null,
    reclaimRuleGraceUntil: null,
    nextFollowUpAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedReason: null,
    isPinned: 0,
    pinnedAt: null,
    pinnedSource: null,
    collaborativeDissolvedAt: null,
    lifecycleStatus: null,
    lifecycleCompletedAt: null,
    lifecycleCompletedBy: null,
    lifecycleCompletionNotes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("customer-profile normalize + validate", () => {
  it("turns blank strings into null", () => {
    const normalized = normalizeCustomerProfileFields({
      preferredName: "  ",
      gender: "",
      ageRange: null,
      preferredLanguage: undefined,
      preferredContactMethod: "  phone  ",
      occupation: " 律師 ",
      companyName: "",
      jobTitle: "  ",
      targetCountryOrRegion: "香港",
      primaryConcern: "",
    });
    assert.equal(normalized.preferredName, null);
    assert.equal(normalized.gender, null);
    assert.equal(normalized.ageRange, null);
    assert.equal(normalized.preferredLanguage, null);
    assert.equal(normalized.preferredContactMethod, "phone");
    assert.equal(normalized.occupation, "律師");
    assert.equal(normalized.companyName, null);
    assert.equal(normalized.jobTitle, null);
    assert.equal(normalized.targetCountryOrRegion, "香港");
    assert.equal(normalized.primaryConcern, null);
  });

  it("accepts all legal enums", () => {
    for (const gender of CUSTOMER_GENDERS) {
      assert.equal(
        validateCustomerProfileFields(
          normalizeCustomerProfileFields({ gender }),
        ).length,
        0,
      );
    }
    for (const ageRange of CUSTOMER_AGE_RANGES) {
      assert.equal(
        validateCustomerProfileFields(
          normalizeCustomerProfileFields({ ageRange }),
        ).length,
        0,
      );
    }
    for (const preferredLanguage of CUSTOMER_PREFERRED_LANGUAGES) {
      assert.equal(
        validateCustomerProfileFields(
          normalizeCustomerProfileFields({ preferredLanguage }),
        ).length,
        0,
      );
    }
    for (const preferredContactMethod of CUSTOMER_PREFERRED_CONTACT_METHODS) {
      assert.equal(
        validateCustomerProfileFields(
          normalizeCustomerProfileFields({ preferredContactMethod }),
        ).length,
        0,
      );
    }
  });

  it("rejects illegal enums and oversized text", () => {
    const errors = validateCustomerProfileFields(
      normalizeCustomerProfileFields({
        gender: "unknown",
        ageRange: "18_24",
        preferredLanguage: "fr",
        preferredContactMethod: "whatsapp",
        preferredName: "x".repeat(41),
        occupation: "x".repeat(61),
        companyName: "x".repeat(121),
        jobTitle: "x".repeat(81),
        targetCountryOrRegion: "x".repeat(81),
        primaryConcern: "x".repeat(201),
      }),
    );
    const codes = new Set(errors.map((e) => e.code));
    assert.ok(codes.has("INVALID_GENDER"));
    assert.ok(codes.has("INVALID_AGE_RANGE"));
    assert.ok(codes.has("INVALID_PREFERRED_LANGUAGE"));
    assert.ok(codes.has("INVALID_PREFERRED_CONTACT_METHOD"));
    assert.ok(codes.has("PREFERRED_NAME_TOO_LONG"));
    assert.ok(codes.has("OCCUPATION_TOO_LONG"));
    assert.ok(codes.has("COMPANY_NAME_TOO_LONG"));
    assert.ok(codes.has("JOB_TITLE_TOO_LONG"));
    assert.ok(codes.has("TARGET_COUNTRY_OR_REGION_TOO_LONG"));
    assert.ok(codes.has("PRIMARY_CONCERN_TOO_LONG"));
  });

  it("allows create with all profile fields empty", () => {
    const errors = validateCustomerInput(BASE_INPUT, {
      requireSalesStage: true,
      allowedSourceKeys: ["referral", "other"],
      enforceCreateNameStatusRules: true,
    });
    assert.equal(errors.length, 0);
  });

  it("rejects create with illegal profile enum via shared validation", () => {
    const errors = validateCustomerInput(
      { ...BASE_INPUT, gender: "not_a_gender" },
      {
        requireSalesStage: true,
        allowedSourceKeys: ["referral", "other"],
        enforceCreateNameStatusRules: true,
      },
    );
    assert.ok(errors.some((e) => e.code === "INVALID_GENDER"));
  });
});

describe("customer-profile masking", () => {
  it("full view includes profile keys; masked view omits them entirely", () => {
    const customer = baseCustomer({
      preferredName: "阿明",
      gender: "male",
      ageRange: "35_44",
      preferredLanguage: "zh_hant",
      preferredContactMethod: "wechat",
      occupation: "工程師",
      companyName: "示例公司",
      jobTitle: "經理",
      targetCountryOrRegion: "香港",
      primaryConcern: "時間安排",
      status: "public_pool",
      ownerId: null,
    });

    const full = toCustomerFullView(customer);
    for (const key of CUSTOMER_PROFILE_FIELD_KEYS) {
      assert.equal(key in full, true, `full missing ${key}`);
    }

    const masked = maskCustomerForStaff(customer);
    const maskedJson = JSON.parse(JSON.stringify(masked)) as Record<
      string,
      unknown
    >;
    for (const key of CUSTOMER_PROFILE_FIELD_KEYS) {
      assert.equal(key in maskedJson, false, `masked leaked ${key}`);
    }

    const staffPool = formatStaffPublicPoolCustomer(
      customer,
      { canClaim: true, claimBlockedReasonKey: null },
      false,
    );
    const poolJson = JSON.parse(JSON.stringify(staffPool)) as Record<
      string,
      unknown
    >;
    for (const key of CUSTOMER_PROFILE_FIELD_KEYS) {
      assert.equal(key in poolJson, false, `pool leaked ${key}`);
    }
    for (const dbName of CUSTOMER_PROFILE_DB_FIELD_NAMES) {
      assert.equal(dbName in poolJson, false);
    }
  });

  it("archived_basic path also omits profile keys", () => {
    const customer = baseCustomer({
      status: "archived",
      preferredName: "阿明",
      companyName: "示例公司",
      primaryConcern: "隱私",
    });
    const masked = maskCustomerForStaff(customer);
    const json = JSON.parse(JSON.stringify(masked)) as Record<string, unknown>;
    for (const key of CUSTOMER_PROFILE_FIELD_KEYS) {
      assert.equal(key in json, false);
    }
  });
});

describe("customer-profile completeness regression", () => {
  it("does not change score when profile fields are null or filled", () => {
    const emptyProfile = baseCustomer();
    const filledProfile = baseCustomer({
      preferredName: "阿明",
      gender: "female",
      ageRange: "25_34",
      preferredLanguage: "en",
      preferredContactMethod: "email",
      occupation: "教師",
      companyName: "學校",
      jobTitle: "主任",
      targetCountryOrRegion: "加拿大",
      primaryConcern: "簽證時間",
    });

    const emptyScore = calculateDataCompletenessScore(emptyProfile, true);
    const filledScore = calculateDataCompletenessScore(filledProfile, true);
    assert.equal(emptyScore.completenessScore, filledScore.completenessScore);
    assert.deepEqual(
      emptyScore.completenessMissingFields,
      filledScore.completenessMissingFields,
    );
  });
});
