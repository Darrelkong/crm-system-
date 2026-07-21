import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveApiError } from "@/i18n/resolve-api-error";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import type { Messages } from "@/i18n/locales/en";
import {
  createRandomClaimFetchInit,
  customerDetailHref,
  DEFINITE_RANDOM_CLAIM_ERROR_CODES,
  isStaffRandomClaimDisabled,
  isUncertainRandomClaimFailure,
  parseRandomClaimSuccessBody,
  RANDOM_CLAIM_API_PATH,
  shouldShowActionsColumn,
  shouldShowRowClaimButton,
  shouldShowStaffRandomClaim,
  staffRandomClaimDisabledReason,
} from "./random-claim-ui";

const ERROR_KEYS = [
  "randomClaimBodyNotAllowed",
  "invalidRequestBody",
  "randomClaimStaffOnly",
  "claimMethodNotAllowed",
  "publicPoolNoEligibleCustomer",
  "publicPoolCandidateScanLimit",
  "publicPoolRandomClaimConflict",
] as const;

const PUBLIC_POOL_KEYS = [
  "randomClaimButton",
  "randomClaimAssigning",
  "randomClaimNoQuota",
  "randomClaimSuccessTitle",
  "randomClaimSuccessBody",
  "randomClaimSuccessAssigned",
  "randomClaimCustomerLabel",
  "randomClaimCustomerCodeLabel",
  "randomClaimViewCustomer",
  "randomClaimReturnToPool",
  "randomClaimStatusRefreshHint",
  "randomClaimUncertain",
] as const;

function tFrom(messages: Messages) {
  return (key: string) => {
    const parts = key.split(".");
    let cur: unknown = messages;
    for (const part of parts) {
      if (!cur || typeof cur !== "object") return key;
      cur = (cur as Record<string, unknown>)[part];
    }
    return typeof cur === "string" ? cur : key;
  };
}

describe("random claim UI role gates", () => {
  it("staff shows random claim and hides row claim / actions", () => {
    assert.equal(shouldShowStaffRandomClaim(false), true);
    assert.equal(shouldShowRowClaimButton(false), false);
    assert.equal(shouldShowActionsColumn(false), false);
  });

  it("admin hides random claim and keeps row claim / actions", () => {
    assert.equal(shouldShowStaffRandomClaim(true), false);
    assert.equal(shouldShowRowClaimButton(true), true);
    assert.equal(shouldShowActionsColumn(true), true);
  });
});

describe("random claim button state", () => {
  it("disables while claiming or when status blocks", () => {
    assert.equal(
      isStaffRandomClaimDisabled(
        { canClaimNow: true },
        true,
      ),
      true,
    );
    assert.equal(
      isStaffRandomClaimDisabled(
        { canClaimNow: false },
        false,
      ),
      true,
    );
    assert.equal(
      isStaffRandomClaimDisabled(
        { canClaimNow: true },
        false,
      ),
      false,
    );
  });

  it("classifies disabled reason for quota vs blocked", () => {
    assert.equal(
      staffRandomClaimDisabledReason(
        {
          canClaimNow: false,
          blockedReasonKey: "quotaExceeded",
          remainingQuota: 0,
        },
        false,
      ),
      "quota",
    );
    assert.equal(
      staffRandomClaimDisabledReason(
        {
          canClaimNow: false,
          blockedReasonKey: "cooldown",
          remainingQuota: 2,
        },
        false,
      ),
      "blocked",
    );
    assert.equal(
      staffRandomClaimDisabledReason(
        {
          canClaimNow: true,
          blockedReasonKey: null,
          remainingQuota: 2,
        },
        true,
      ),
      "loading",
    );
  });
});

describe("random claim request", () => {
  it("builds POST with Accept header and no body or Content-Type", () => {
    const init = createRandomClaimFetchInit();
    assert.equal(init.method, "POST");
    assert.equal(RANDOM_CLAIM_API_PATH, "/api/public-pool/claim-random");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Accept, "application/json");
    assert.equal("Content-Type" in headers, false);
    assert.equal(init.body, undefined);
    assert.equal(JSON.stringify(init).includes("customerId"), false);
  });

  it("builds customer detail href", () => {
    assert.equal(customerDetailHref("cust-1"), "/customers/cust-1");
  });
});

describe("random claim success parse", () => {
  it("accepts exact success payload without inventing PII fields", () => {
    const parsed = parseRandomClaimSuccessBody({
      ok: true,
      customerId: "c1",
      customerCode: "C-1",
      customerName: "Alice",
      taskId: "t1",
      phone: "should-be-ignored",
    });
    assert.ok(parsed);
    assert.equal(parsed!.customerId, "c1");
    assert.equal(parsed!.customerCode, "C-1");
    assert.equal(parsed!.customerName, "Alice");
    assert.equal(parsed!.taskId, "t1");
    assert.equal("phone" in parsed!, false);
  });

  it("rejects non-ok or incomplete bodies", () => {
    assert.equal(parseRandomClaimSuccessBody({ ok: false }), null);
    assert.equal(
      parseRandomClaimSuccessBody({
        ok: true,
        customerId: "c1",
        customerName: "A",
      }),
      null,
    );
  });
});

describe("uncertain vs definite random claim errors", () => {
  it("treats network / unknown 5xx / parse failure as uncertain", () => {
    assert.equal(isUncertainRandomClaimFailure({ networkError: true }), true);
    assert.equal(isUncertainRandomClaimFailure({ httpStatus: 500 }), true);
    assert.equal(
      isUncertainRandomClaimFailure({
        httpStatus: 503,
        errorCode: "UNKNOWN_SERVER_ERROR",
      }),
      true,
    );
    assert.equal(
      isUncertainRandomClaimFailure({ httpStatus: 503, errorCode: null }),
      true,
    );
    assert.equal(
      isUncertainRandomClaimFailure({ jsonParseFailed: true }),
      true,
    );
    assert.equal(isUncertainRandomClaimFailure({ errorCode: null }), true);
  });

  it("treats PUBLIC_POOL_CANDIDATE_SCAN_LIMIT + 503 as definite", () => {
    assert.equal(
      isUncertainRandomClaimFailure({
        errorCode: "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT",
        httpStatus: 503,
      }),
      false,
    );
    const tEn = tFrom(en);
    assert.equal(
      resolveApiError(tEn, {
        errorCode: "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT",
      }),
      en.errors.publicPoolCandidateScanLimit,
    );
    assert.notEqual(
      resolveApiError(tEn, {
        errorCode: "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT",
      }),
      en.publicPool.randomClaimUncertain,
    );
  });

  it("keeps known business codes definite even when HTTP is 5xx", () => {
    assert.equal(
      isUncertainRandomClaimFailure({
        errorCode: "CLAIM_COOLDOWN",
        httpStatus: 500,
      }),
      false,
    );
    assert.equal(
      isUncertainRandomClaimFailure({
        errorCode: "CLAIM_QUOTA_EXCEEDED",
        httpStatus: 500,
      }),
      false,
    );
    assert.equal(
      isUncertainRandomClaimFailure({
        errorCode: "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT",
        httpStatus: 503,
      }),
      false,
    );
  });

  it("keeps quota/cooldown/scan/conflict as definite with real statuses", () => {
    const cases: Array<{ code: string; httpStatus: number }> = [
      { code: "CLAIM_COOLDOWN", httpStatus: 403 },
      { code: "CLAIM_QUOTA_EXCEEDED", httpStatus: 429 },
      { code: "PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER", httpStatus: 404 },
      { code: "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT", httpStatus: 503 },
      { code: "PUBLIC_POOL_RANDOM_CLAIM_CONFLICT", httpStatus: 409 },
      { code: "CLAIM_METHOD_NOT_ALLOWED", httpStatus: 403 },
      { code: "RANDOM_CLAIM_STAFF_ONLY", httpStatus: 403 },
    ];
    for (const { code, httpStatus } of cases) {
      assert.equal(
        isUncertainRandomClaimFailure({ errorCode: code, httpStatus }),
        false,
        `${code}+${httpStatus}`,
      );
      assert.ok(DEFINITE_RANDOM_CLAIM_ERROR_CODES.has(code));
    }
  });

  it("does not auto-retry: helpers never enqueue a second request", () => {
    // Documented contract: UI uses inFlightRef + disabled; helpers stay pure.
    const first = createRandomClaimFetchInit();
    const second = createRandomClaimFetchInit();
    assert.deepEqual(first, second);
  });
});

describe("random claim i18n + error resolver", () => {
  it("has matching publicPool keys in en / zh-Hans / zh-Hant", () => {
    for (const key of PUBLIC_POOL_KEYS) {
      assert.equal(typeof en.publicPool[key], "string", `en ${key}`);
      assert.equal(typeof zhHans.publicPool[key], "string", `zh-Hans ${key}`);
      assert.equal(typeof zhHant.publicPool[key], "string", `zh-Hant ${key}`);
      assert.notEqual(en.publicPool[key], `publicPool.${key}`);
    }
  });

  it("has matching errors keys and resolver mappings", () => {
    const tEn = tFrom(en);
    const tHans = tFrom(zhHans as Messages);
    const tHant = tFrom(zhHant as Messages);

    const cases: Array<{ code: string; key: (typeof ERROR_KEYS)[number] }> = [
      { code: "RANDOM_CLAIM_BODY_NOT_ALLOWED", key: "randomClaimBodyNotAllowed" },
      { code: "INVALID_REQUEST_BODY", key: "invalidRequestBody" },
      { code: "RANDOM_CLAIM_STAFF_ONLY", key: "randomClaimStaffOnly" },
      { code: "CLAIM_METHOD_NOT_ALLOWED", key: "claimMethodNotAllowed" },
      {
        code: "PUBLIC_POOL_NO_ELIGIBLE_CUSTOMER",
        key: "publicPoolNoEligibleCustomer",
      },
      {
        code: "PUBLIC_POOL_CANDIDATE_SCAN_LIMIT",
        key: "publicPoolCandidateScanLimit",
      },
      {
        code: "PUBLIC_POOL_RANDOM_CLAIM_CONFLICT",
        key: "publicPoolRandomClaimConflict",
      },
    ];

    for (const { code, key } of cases) {
      assert.equal(typeof en.errors[key], "string", key);
      assert.equal(typeof zhHans.errors[key], "string", key);
      assert.equal(typeof zhHant.errors[key], "string", key);
      assert.equal(resolveApiError(tEn, { errorCode: code }), en.errors[key]);
      assert.equal(
        resolveApiError(tHans, { errorCode: code }),
        zhHans.errors[key],
      );
      assert.equal(
        resolveApiError(tHant, { errorCode: code }),
        zhHant.errors[key],
      );
      assert.notEqual(resolveApiError(tEn, { errorCode: code }), code);
    }
  });
});
