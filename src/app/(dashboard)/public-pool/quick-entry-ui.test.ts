import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  QUICK_ENTRY_CUSTOMERS_API_PATH,
  QUICK_ENTRY_STATUS_API_PATH,
  QUICK_ENTRY_UI_MAX_ROWS,
  QUICK_ENTRY_VERIFY_API_PATH,
  buildCustomersRequestBody,
  buildVerifyCodeBody,
  canAddQuickEntryRow,
  canRemoveQuickEntryRow,
  clearQuickEntryRow,
  createEmptyQuickEntryRow,
  createNewQuickEntryBatch,
  customersRequestBodyHasForbiddenKeys,
  isSafeVerifyBody,
  mapResultsByClientRowId,
  parseBatchFailureResponse,
  parseBatchSuccessResponse,
  parseQuickEntryStatus,
  parseVerifySuccess,
  planAfterBatchFailure,
  resolveQuickEntryPanelMode,
  resultsContainContactPii,
  shouldShowQuickEntryEntry,
  validateQuickEntryFormRows,
} from "./quick-entry-ui";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";
const uuidC = "33333333-3333-4333-8333-333333333333";

describe("quick entry status / modes", () => {
  it("parses status", () => {
    const parsed = parseQuickEntryStatus({
      enabled: true,
      hasCode: true,
      grantActive: false,
      grantExpiresAt: null,
      locked: false,
      lockedUntil: null,
      retryAfterSeconds: null,
    });
    assert.equal(parsed.ok, true);
  });

  it("maps modes for disabled / locked / verify / form", () => {
    assert.equal(
      resolveQuickEntryPanelMode({
        enabled: false,
        hasCode: true,
        grantActive: false,
        grantExpiresAt: null,
        locked: false,
        lockedUntil: null,
        retryAfterSeconds: null,
      }).mode,
      "disabled",
    );
    assert.equal(
      resolveQuickEntryPanelMode({
        enabled: true,
        hasCode: true,
        grantActive: false,
        grantExpiresAt: null,
        locked: true,
        lockedUntil: "x",
        retryAfterSeconds: 30,
      }).mode,
      "locked",
    );
    assert.equal(
      resolveQuickEntryPanelMode({
        enabled: true,
        hasCode: true,
        grantActive: false,
        grantExpiresAt: null,
        locked: false,
        lockedUntil: null,
        retryAfterSeconds: null,
      }).mode,
      "verify",
    );
    assert.equal(
      resolveQuickEntryPanelMode({
        enabled: true,
        hasCode: true,
        grantActive: true,
        grantExpiresAt: "x",
        locked: false,
        lockedUntil: null,
        retryAfterSeconds: null,
      }).mode,
      "form",
    );
  });

  it("shows disabled subtle entry when feature off", () => {
    assert.deepEqual(
      shouldShowQuickEntryEntry({
        enabled: false,
        hasCode: false,
        grantActive: false,
        grantExpiresAt: null,
        locked: false,
        lockedUntil: null,
        retryAfterSeconds: null,
      }),
      { visible: true, reason: "disabled" },
    );
  });
});

describe("submission and clientRowId stability", () => {
  it("creates stable ids that are not array indexes", () => {
    let n = 0;
    const ids = [uuidA, uuidB, uuidC];
    const randomUuid = () => ids[n++]!;
    const batch = createNewQuickEntryBatch(randomUuid);
    assert.equal(batch.submissionId, uuidA);
    assert.equal(batch.rows[0]?.clientRowId, uuidB);
    assert.notEqual(batch.rows[0]?.clientRowId, "0");
  });

  it("clearing a row keeps clientRowId", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    row.customerName = "张三";
    row.phone = "13800138000";
    const cleared = clearQuickEntryRow(row);
    assert.equal(cleared.clientRowId, uuidA);
    assert.equal(cleared.customerName, "");
    assert.equal(cleared.phone, "");
  });

  it("new batch generates new submissionId", () => {
    let n = 0;
    const ids = [uuidA, uuidB, uuidC, "44444444-4444-4444-8444-444444444444"];
    const randomUuid = () => ids[n++]!;
    const first = createNewQuickEntryBatch(randomUuid);
    const second = createNewQuickEntryBatch(randomUuid);
    assert.notEqual(first.submissionId, second.submissionId);
  });
});

describe("row limits and validation", () => {
  it("enforces max 20 and last-row clear semantics helpers", () => {
    assert.equal(canAddQuickEntryRow(19), true);
    assert.equal(canAddQuickEntryRow(20), false);
    assert.equal(canRemoveQuickEntryRow(1), false);
    assert.equal(canRemoveQuickEntryRow(2), true);
    assert.equal(QUICK_ENTRY_UI_MAX_ROWS, 20);
  });

  it("requires name, project, and phone or wechat", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.customerName = "张三";
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.requestedProjectName = "项目";
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.phone = "13800138000";
    assert.equal(validateQuickEntryFormRows([row]).ok, true);
  });
});

describe("request body security", () => {
  it("verify body only contains code", () => {
    const body = buildVerifyCodeBody("Abcd1234");
    assert.deepEqual(body, { code: "Abcd1234" });
    assert.equal(isSafeVerifyBody(body), true);
    assert.equal(isSafeVerifyBody({ code: "x", actorId: "y" }), false);
  });

  it("customers body has only submissionId + allowlisted row fields", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    row.customerName = "张三";
    row.phone = "13800138000";
    row.requestedProjectName = "项目A";
    const body = buildCustomersRequestBody(uuidB, [row]);
    assert.deepEqual(Object.keys(body).sort(), ["rows", "submissionId"]);
    assert.equal(body.rows[0]?.phoneCountryCode, "+86");
    assert.equal(
      customersRequestBodyHasForbiddenKeys(body as unknown as Record<string, unknown>),
      false,
    );
    assert.ok(!JSON.stringify(body).includes("submissionDbId"));
    assert.ok(!JSON.stringify(body).includes("requestHash"));
    assert.ok(!JSON.stringify(body).includes("actorId"));
    assert.ok(!JSON.stringify(body).includes("ownerId"));
    assert.ok(!JSON.stringify(body).includes("salesStage"));
  });

  it("defaults country code to +86 and keeps it on clear", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    assert.equal(row.phoneCountryCode, "+86");
    const cleared = clearQuickEntryRow(row);
    assert.equal(cleared.phoneCountryCode, "+86");
  });

  it("client validation rejects invalid phones and requires contact", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    row.customerName = "张三";
    row.requestedProjectName = "移民项目咨询";
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.phone = "1380013800";
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.phone = "13800138000";
    assert.equal(validateQuickEntryFormRows([row]).ok, true);
    row.phone = "";
    row.wechatId = "wx_ok";
    assert.equal(validateQuickEntryFormRows([row]).ok, true);
  });

  it("detects injected internal fields", () => {
    assert.equal(
      customersRequestBodyHasForbiddenKeys({
        submissionId: uuidA,
        rows: [],
        submissionDbId: "x",
      }),
      true,
    );
    assert.equal(
      customersRequestBodyHasForbiddenKeys({
        submissionId: uuidA,
        rows: [{ clientRowId: uuidB, customerName: "a", requestedProjectName: "b", ownerId: "z" }],
      }),
      true,
    );
  });
});

describe("batch response parsing and plans", () => {
  it("parses all created / partial / replay", () => {
    const success = parseBatchSuccessResponse(
      {
        ok: true,
        submissionId: uuidA,
        replayed: true,
        summary: {
          total: 2,
          created: 1,
          duplicates: 1,
          invalid: 0,
          failed: 0,
        },
        results: [
          {
            clientRowId: uuidB,
            status: "created",
            customerId: "c1",
            customerCode: "EF000001",
            customerName: "张三",
          },
          {
            clientRowId: uuidC,
            status: "duplicate",
            errorCode: "QUICK_ENTRY_DUPLICATE_PHONE",
            duplicateField: "phone",
          },
        ],
      },
      true,
    );
    assert.ok(success);
    assert.equal(success?.replayed, true);
    assert.equal(success?.summary.created, 1);
    assert.equal(resultsContainContactPii(success!.results), false);
    const map = mapResultsByClientRowId(success!.results);
    assert.equal(map.get(uuidB)?.status, "created");
    assert.equal(map.get(uuidC)?.status, "duplicate");
  });

  it("maps processing / conflict / grant / disabled", () => {
    assert.deepEqual(planAfterBatchFailure("QUICK_ENTRY_SUBMISSION_PROCESSING"), {
      action: "retry_same_submission",
      keepSubmissionId: true,
    });
    assert.deepEqual(planAfterBatchFailure("QUICK_ENTRY_IDEMPOTENCY_CONFLICT"), {
      action: "require_new_batch",
      keepSubmissionId: false,
    });
    assert.deepEqual(planAfterBatchFailure("QUICK_ENTRY_GRANT_EXPIRED"), {
      action: "require_reverify",
      keepSubmissionId: true,
    });
    assert.deepEqual(planAfterBatchFailure("QUICK_ENTRY_DISABLED"), {
      action: "feature_disabled",
      keepSubmissionId: true,
    });
  });

  it("parses verify success and failure", () => {
    assert.deepEqual(
      parseVerifySuccess({ ok: true, grantExpiresAt: "2026-01-01T00:00:00.000Z" }, true),
      { ok: true, grantExpiresAt: "2026-01-01T00:00:00.000Z" },
    );
    assert.equal(
      parseVerifySuccess(
        { ok: false, errorCode: "QUICK_ENTRY_CODE_INVALID" },
        false,
      ).ok,
      false,
    );
  });

  it("parses batch failure with retryAfterSeconds", () => {
    const failure = parseBatchFailureResponse({
      ok: false,
      error: "processing",
      errorCode: "QUICK_ENTRY_SUBMISSION_PROCESSING",
      retryAfterSeconds: 12.8,
    });
    assert.equal(failure.errorCode, "QUICK_ENTRY_SUBMISSION_PROCESSING");
    assert.equal(failure.retryAfterSeconds, 12);
  });
});

describe("quick entry UI wiring and security scans", () => {
  const pageSrc = readFileSync(
    new URL("./public-pool-page-client.tsx", import.meta.url),
    "utf8",
  );
  const panelSrc = readFileSync(
    new URL("./staff-quick-entry-panel.tsx", import.meta.url),
    "utf8",
  );
  const randomClaimSrc = readFileSync(
    new URL("./staff-random-claim-panel.tsx", import.meta.url),
    "utf8",
  );

  it("wires panel without modifying random claim file contents for quick entry", () => {
    assert.match(pageSrc, /StaffQuickEntryPanel/);
    assert.match(pageSrc, /StaffRandomClaimPanel/);
    assert.ok(!randomClaimSrc.includes("quick-entry"));
    assert.ok(!randomClaimSrc.includes("QuickEntry"));
  });

  it("panel only uses the four quick entry APIs", () => {
    assert.match(panelSrc, /QUICK_ENTRY_STATUS_API_PATH/);
    assert.match(panelSrc, /QUICK_ENTRY_VERIFY_API_PATH/);
    assert.match(panelSrc, /QUICK_ENTRY_CUSTOMERS_API_PATH/);
    assert.equal(QUICK_ENTRY_STATUS_API_PATH, "/api/public-pool/quick-entry/status");
    assert.equal(QUICK_ENTRY_VERIFY_API_PATH, "/api/public-pool/quick-entry/verify");
    assert.equal(
      QUICK_ENTRY_CUSTOMERS_API_PATH,
      "/api/public-pool/quick-entry/customers",
    );
  });

  it("does not persist code/form or log secrets", () => {
    assert.ok(!panelSrc.includes("localStorage"));
    assert.ok(!panelSrc.includes("sessionStorage"));
    assert.ok(!panelSrc.includes("console.log"));
    assert.ok(!panelSrc.includes("console.error"));
    assert.ok(!panelSrc.includes("console.warn"));
    assert.ok(!panelSrc.includes("console.debug"));
    assert.ok(!panelSrc.includes("submissionDbId"));
    assert.ok(!panelSrc.includes("requestHash"));
    assert.ok(!panelSrc.includes("expectedProcessingStartedAt"));
    assert.ok(!panelSrc.includes("actorId"));
    assert.ok(!panelSrc.includes("ownerId"));
    assert.ok(!panelSrc.includes("salesStage"));
  });

  it("locks country code to +86 and maps known row errors", () => {
    assert.match(panelSrc, /QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE/);
    assert.match(panelSrc, /readOnly/);
    assert.match(panelSrc, /QUICK_ENTRY_PHONE_INVALID/);
    assert.match(panelSrc, /QUICK_ENTRY_PROJECT_INVALID/);
    assert.match(panelSrc, /QUICK_ENTRY_PHONE_COUNTRY_CODE_INVALID/);
    assert.match(panelSrc, /reviseNeedsNewBatch/);
    assert.match(panelSrc, /type="tel"/);
    assert.match(panelSrc, /maxLength=\{11\}/);
  });

  it("keeps submissionId on retry helpers and clears verify code after success path", () => {
    assert.match(panelSrc, /createNewQuickEntryBatch/);
    assert.match(panelSrc, /setVerifyCode\(""\)/);
    assert.match(panelSrc, /retry_same_submission|processingRetryAfter/);
  });
});

describe("quick entry i18n keys", () => {
  it("has core keys in three locales", () => {
    assert.equal(en.publicPool.quickEntry.entryTitle, "Quick Customer Entry");
    assert.equal(zhHant.publicPool.quickEntry.entryTitle, "快速錄入客戶");
    assert.equal(zhHans.publicPool.quickEntry.entryTitle, "快速录入客户");
    assert.ok(en.publicPool.quickEntry.fields.customerName.length > 0);
    assert.ok(zhHant.publicPool.quickEntry.fields.wechatId.length > 0);
    assert.ok(zhHans.settings.publicPoolQuickEntry.title.includes("快速录入"));
    assert.ok(
      zhHant.publicPool.quickEntry.errors.phoneInvalid.includes("11"),
    );
    assert.ok(
      zhHans.publicPool.quickEntry.errors.countryCodeInvalid.includes("+86"),
    );
    assert.ok(en.publicPool.quickEntry.reviseNeedsNewBatch.length > 0);
  });
});
