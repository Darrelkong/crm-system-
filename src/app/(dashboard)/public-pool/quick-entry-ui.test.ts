import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  QUICK_ENTRY_CUSTOMERS_API_PATH,
  QUICK_ENTRY_PROJECT_SUGGESTIONS,
  QUICK_ENTRY_STATUS_API_PATH,
  QUICK_ENTRY_UI_MAX_ROWS,
  QUICK_ENTRY_VERIFY_API_PATH,
  applyQuickEntryModeSwitchChoice,
  buildCustomersRequestBody,
  buildQuickEntryCardSummary,
  buildVerifyCodeBody,
  canAddQuickEntryRow,
  canRemoveQuickEntryRow,
  clearQuickEntryRow,
  cloneRowsWithNewClientRowIds,
  countFieldErrorRows,
  createEmptyQuickEntryRow,
  createNewQuickEntryBatch,
  customersRequestBodyHasForbiddenKeys,
  deriveQuickEntryCardBadge,
  deriveSingleEntryResultKind,
  filterIncompleteRowsForRetry,
  filterProjectSuggestions,
  firstErrorClientRowId,
  firstFieldErrorKey,
  initialAccordionOpenIds,
  isQuickEntryBatchDirty,
  isSafeVerifyBody,
  mapResultsByClientRowId,
  parseBatchFailureResponse,
  parseBatchSuccessResponse,
  parseQuickEntryStatus,
  parseVerifySuccess,
  planAfterBatchFailure,
  planQuickEntryModeSwitch,
  prepareContinueEntryRow,
  prepareRetryBatchFromIncomplete,
  resolveQuickEntryLayout,
  resolveQuickEntryPanelMode,
  resultsContainContactPii,
  shouldConfirmDeleteQuickEntryRow,
  shouldShowQuickEntryEntry,
  validateQuickEntryFormRows,
} from "./quick-entry-ui";
import { Input, Textarea } from "@/components/ui/form";
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

  it("requires name, project (>=4 chars), and phone or wechat", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.customerName = "张三";
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.requestedProjectName = "项目";
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.requestedProjectName = "移民项目咨询";
    assert.equal(validateQuickEntryFormRows([row]).ok, false);
    row.phone = "13800138000";
    assert.equal(validateQuickEntryFormRows([row]).ok, true);
  });

  it("returns field-level errors for single-entry UX", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    row.customerName = "";
    row.requestedProjectName = "測試";
    row.phone = "1380013800";
    const result = validateQuickEntryFormRows([row]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.fieldErrors[uuidA]?.customerName, "name_required");
    assert.equal(result.fieldErrors[uuidA]?.requestedProjectName, "project_invalid");
    assert.equal(result.fieldErrors[uuidA]?.phone, "phone_invalid");
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
    row.requestedProjectName = "移民项目咨询";
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
    assert.match(panelSrc, /qe-phone-wrap/);
    assert.match(panelSrc, /qe-phone-prefix/);
    assert.match(panelSrc, /QUICK_ENTRY_PHONE_INVALID/);
    assert.match(panelSrc, /QUICK_ENTRY_PROJECT_INVALID/);
    assert.match(panelSrc, /QUICK_ENTRY_PHONE_COUNTRY_CODE_INVALID/);
    assert.match(panelSrc, /reviseNeedsNewBatch/);
    assert.match(panelSrc, /type="tel"/);
    assert.match(panelSrc, /maxLength=\{11\}/);
  });

  it("uses drawer shell with single/batch modes and continue lifecycle", () => {
    assert.match(panelSrc, /QuickEntryDrawer/);
    assert.match(panelSrc, /modeSingle/);
    assert.match(panelSrc, /modeBatch/);
    assert.match(panelSrc, /saveContinue/);
    assert.match(panelSrc, /saveDone/);
    assert.match(panelSrc, /prepareContinueEntryRow/);
    assert.match(panelSrc, /createNewQuickEntryBatch/);
    assert.match(panelSrc, /handleBackToEdit/);
    assert.match(panelSrc, /metaKey \|\| event\.ctrlKey/);
    assert.match(panelSrc, /isQuickEntryBatchDirty/);
    assert.match(panelSrc, /resultSuccessTitle/);
    assert.ok(!panelSrc.includes("ModalOverlay onClose={submitting"));
  });

  it("wires Phase C accordion, results, and mode-switch protection", () => {
    const batchUiSrc = readFileSync(
      new URL("./quick-entry-batch-ui.tsx", import.meta.url),
      "utf8",
    );
    assert.match(panelSrc, /BatchAccordionForm/);
    assert.match(panelSrc, /BatchResultsPanel/);
    assert.match(panelSrc, /planQuickEntryModeSwitch/);
    assert.match(panelSrc, /prepareRetryBatchFromIncomplete/);
    assert.match(panelSrc, /handleReturnIncomplete/);
    assert.match(panelSrc, /batchSubmitCount/);
    assert.match(panelSrc, /batchNeedsFix/);
    assert.match(panelSrc, /modeSwitchConfirm/);
    assert.match(panelSrc, /deleteConfirmId/);
    assert.match(batchUiSrc, /aria-expanded/);
    assert.match(batchUiSrc, /BatchAccordionForm/);
    assert.match(batchUiSrc, /resultViewDetails/);
    assert.ok(!panelSrc.includes("function BatchEntryForm"));
    assert.ok(!panelSrc.includes("function BatchResultsView"));
  });

  it("keeps submissionId on retry helpers and clears verify code after success path", () => {
    assert.match(panelSrc, /createNewQuickEntryBatch/);
    assert.match(panelSrc, /setVerifyCode\(""\)/);
    assert.match(panelSrc, /retry_same_submission|processingRetryAfter/);
  });
});

describe("quick entry V2 helpers", () => {
  it("prepareContinueEntryRow allocates new clientRowId and optional project keep", () => {
    let n = 0;
    const ids = [uuidA, uuidB];
    const randomUuid = () => ids[n++]!;
    const previous = createEmptyQuickEntryRow(() => "00000000-0000-4000-8000-000000000000");
    previous.customerName = "张三";
    previous.phone = "13800138000";
    previous.requestedProjectName = "美国个人银行开户";
    const kept = prepareContinueEntryRow(previous, true, randomUuid);
    assert.equal(kept.clientRowId, uuidA);
    assert.equal(kept.customerName, "");
    assert.equal(kept.phone, "");
    assert.equal(kept.requestedProjectName, "美国个人银行开户");
    const cleared = prepareContinueEntryRow(previous, false, randomUuid);
    assert.equal(cleared.clientRowId, uuidB);
    assert.equal(cleared.requestedProjectName, "");
  });

  it("filters project suggestions and derives single result kinds", () => {
    assert.ok(QUICK_ENTRY_PROJECT_SUGGESTIONS.includes("ITIN申請"));
    assert.deepEqual(
      filterProjectSuggestions("香港"),
      QUICK_ENTRY_PROJECT_SUGGESTIONS.filter((s) => s.includes("香港")),
    );
    assert.equal(
      deriveSingleEntryResultKind({
        clientRowId: uuidA,
        status: "created",
        customerId: "c",
        customerCode: "EF1",
        customerName: "张三",
      }),
      "success",
    );
    assert.equal(
      deriveSingleEntryResultKind({
        clientRowId: uuidA,
        status: "duplicate",
        errorCode: "QUICK_ENTRY_DUPLICATE_PHONE",
        duplicateField: "phone",
      }),
      "duplicate",
    );
    assert.equal(
      firstFieldErrorKey({
        phone: "phone_invalid",
        customerName: "name_required",
      }),
      "customerName",
    );
    assert.equal(
      isQuickEntryBatchDirty([
        {
          ...createEmptyQuickEntryRow(() => uuidA),
          customerName: "x",
        },
      ]),
      true,
    );
  });
});

describe("quick entry V2 Phase C batch accordion helpers", () => {
  it("defaults accordion open to the first card only", () => {
    const a = createEmptyQuickEntryRow(() => uuidA);
    const b = createEmptyQuickEntryRow(() => uuidB);
    assert.deepEqual(initialAccordionOpenIds([a, b]), [uuidA]);
  });

  it("builds card summary from name / phone / wechat / project", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    assert.equal(buildQuickEntryCardSummary(row).nameEmpty, true);
    assert.equal(buildQuickEntryCardSummary(row).contactKind, "empty");
    assert.equal(buildQuickEntryCardSummary(row).projectEmpty, true);
    row.customerName = "张三";
    row.phone = "13800138000";
    row.requestedProjectName = "移民项目咨询";
    const summary = buildQuickEntryCardSummary(row);
    assert.equal(summary.nameEmpty, false);
    assert.equal(summary.contactKind, "phone");
    assert.equal(summary.contactText, "+8613800138000");
    assert.equal(summary.projectEmpty, false);
    row.phone = "";
    row.wechatId = "wx_demo";
    assert.equal(buildQuickEntryCardSummary(row).contactKind, "wechat");
  });

  it("derives card badges for incomplete / ready / error / results", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    assert.equal(deriveQuickEntryCardBadge(row), "incomplete");
    row.customerName = "张三";
    row.phone = "13800138000";
    row.requestedProjectName = "移民项目咨询";
    assert.equal(deriveQuickEntryCardBadge(row), "ready");
    assert.equal(
      deriveQuickEntryCardBadge(row, { hasFieldErrors: true }),
      "error",
    );
    assert.equal(
      deriveQuickEntryCardBadge(row, { submitting: true }),
      "submitting",
    );
    assert.equal(
      deriveQuickEntryCardBadge(row, {
        result: {
          clientRowId: uuidA,
          status: "created",
          customerId: "c",
          customerCode: "EF1",
          customerName: "张三",
        },
      }),
      "created",
    );
    assert.equal(
      deriveQuickEntryCardBadge(row, {
        result: {
          clientRowId: uuidA,
          status: "duplicate",
          errorCode: "QUICK_ENTRY_DUPLICATE_PHONE",
          duplicateField: "phone",
        },
      }),
      "duplicate",
    );
    assert.equal(
      deriveQuickEntryCardBadge(row, {
        result: {
          clientRowId: uuidA,
          status: "invalid",
          errorCode: "QUICK_ENTRY_PROJECT_INVALID",
        },
      }),
      "invalid",
    );
    assert.equal(
      deriveQuickEntryCardBadge(row, {
        result: {
          clientRowId: uuidA,
          status: "failed",
          errorCode: "QUICK_ENTRY_CUSTOMER_VALIDATION_FAILED",
        },
      }),
      "failed",
    );
  });

  it("confirms delete only for dirty rows and keeps at least one card via remove helper", () => {
    const blank = createEmptyQuickEntryRow(() => uuidA);
    const dirty = {
      ...createEmptyQuickEntryRow(() => uuidB),
      customerName: "李四",
    };
    assert.equal(shouldConfirmDeleteQuickEntryRow(blank), false);
    assert.equal(shouldConfirmDeleteQuickEntryRow(dirty), true);
    assert.equal(canRemoveQuickEntryRow(1), false);
  });

  it("keeps clientRowId stable when cloning fields and allocates new ids for retry", () => {
    const row = createEmptyQuickEntryRow(() => uuidA);
    row.customerName = "张三";
    row.phone = "13800138000";
    row.requestedProjectName = "移民项目咨询";
    const patched = { ...row, wechatId: "wx" };
    assert.equal(patched.clientRowId, uuidA);
    let n = 0;
    const ids = [
      uuidB,
      uuidC,
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];
    const randomUuid = () => ids[n++]!;
    const cloned = cloneRowsWithNewClientRowIds([row], randomUuid);
    assert.equal(cloned[0]?.clientRowId, uuidB);
    assert.equal(cloned[0]?.customerName, "张三");
    assert.notEqual(cloned[0]?.clientRowId, uuidA);
  });

  it("finds first error card and counts field-error rows", () => {
    const a = createEmptyQuickEntryRow(() => uuidA);
    const b = createEmptyQuickEntryRow(() => uuidB);
    const fieldErrors = {
      [uuidB]: { customerName: "name_required" as const },
      [uuidA]: { phone: "phone_invalid" as const },
    };
    assert.equal(firstErrorClientRowId(fieldErrors, [a, b]), uuidA);
    assert.equal(countFieldErrorRows(fieldErrors), 2);
  });

  it("plans mode switches without silent multi-row loss", () => {
    const dirtyA = {
      ...createEmptyQuickEntryRow(() => uuidA),
      customerName: "张三",
      phone: "13800138000",
      requestedProjectName: "移民项目咨询",
    };
    const dirtyB = {
      ...createEmptyQuickEntryRow(() => uuidB),
      customerName: "李四",
      wechatId: "wx_b",
      requestedProjectName: "移民项目咨询",
    };
    assert.equal(
      planQuickEntryModeSwitch("single", "batch", [dirtyA], true).action,
      "blocked_submitting",
    );
    assert.equal(
      planQuickEntryModeSwitch("single", "batch", [dirtyA], false).action,
      "confirm",
    );
    assert.equal(
      planQuickEntryModeSwitch("batch", "single", [dirtyA], false).action,
      "direct",
    );
    const multi = planQuickEntryModeSwitch(
      "batch",
      "single",
      [dirtyA, dirtyB],
      false,
    );
    assert.equal(multi.action, "confirm");
    if (multi.action === "confirm") {
      assert.equal(multi.reason, "batch_multi_to_single");
    }
    const kept = applyQuickEntryModeSwitchChoice(
      "single",
      "batch_multi_to_single",
      "keep_first",
      [dirtyA, dirtyB],
    );
    assert.equal(kept?.entryMode, "single");
    assert.equal(kept?.rows.length, 1);
    assert.equal(kept?.rows[0]?.clientRowId, uuidA);
    const discarded = applyQuickEntryModeSwitchChoice(
      "batch",
      "single_to_batch_dirty",
      "discard",
      [dirtyA],
    );
    assert.equal(discarded?.entryMode, "batch");
    assert.equal(discarded?.rows[0]?.customerName, "");
  });

  it("filters incomplete rows and prepares retry with new submissionId/clientRowIds", () => {
    const created = {
      ...createEmptyQuickEntryRow(() => uuidA),
      customerName: "张三",
      phone: "13800138000",
      requestedProjectName: "移民项目咨询",
    };
    const dup = {
      ...createEmptyQuickEntryRow(() => uuidB),
      customerName: "李四",
      phone: "13900139000",
      requestedProjectName: "移民项目咨询",
    };
    const results = [
      {
        clientRowId: uuidA,
        status: "created" as const,
        customerId: "c1",
        customerCode: "EF000001",
        customerName: "张三",
      },
      {
        clientRowId: uuidB,
        status: "duplicate" as const,
        errorCode: "QUICK_ENTRY_DUPLICATE_PHONE",
        duplicateField: "phone" as const,
      },
    ];
    const incomplete = filterIncompleteRowsForRetry([created, dup], results);
    assert.equal(incomplete.length, 1);
    assert.equal(incomplete[0]?.clientRowId, uuidB);
    let n = 0;
    const ids = [
      uuidC,
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];
    const randomUuid = () => ids[n++]!;
    const prepared = prepareRetryBatchFromIncomplete(
      [created, dup],
      results,
      randomUuid,
    );
    assert.equal(prepared.submissionId, uuidC);
    assert.equal(prepared.rows.length, 1);
    assert.equal(prepared.rows[0]?.customerName, "李四");
    assert.notEqual(prepared.rows[0]?.clientRowId, uuidB);
  });

  it("resolves desktop/tablet/mobile layout structure hints", () => {
    assert.deepEqual(resolveQuickEntryLayout("mobile").shell, "sheet");
    assert.equal(resolveQuickEntryLayout("mobile").formColumns, 1);
    assert.equal(resolveQuickEntryLayout("tablet").shell, "drawer");
    assert.equal(resolveQuickEntryLayout("desktop").panelWidthHint, "520px-600px");
    assert.equal(resolveQuickEntryLayout("desktop").accordionDefaultOpenCount, 1);
  });
});

describe("quick entry form displayName", () => {
  it("sets Input and Textarea displayName", () => {
    assert.equal(Input.displayName, "Input");
    assert.equal(Textarea.displayName, "Textarea");
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
    assert.equal(en.publicPool.quickEntry.modeSingle, "Single entry");
    assert.equal(zhHant.publicPool.quickEntry.modeSingle, "單筆錄入");
    assert.equal(zhHans.publicPool.quickEntry.modeSingle, "单笔录入");
    assert.ok(en.publicPool.quickEntry.validation.project_invalid.length > 0);
    assert.ok(zhHant.publicPool.quickEntry.saveContinue.length > 0);
    assert.ok(zhHans.publicPool.quickEntry.resultSuccessTitle.length > 0);
  });

  it("has Phase C batch keys aligned across locales", () => {
    const keys = [
      "batchAddedCount",
      "batchExpandAll",
      "batchCollapseAll",
      "batchSubmitCount",
      "batchNeedsFix",
      "batchEmptyName",
      "batchEmptyContact",
      "batchEmptyProject",
      "returnIncomplete",
      "modeSwitchTitle",
      "modeSwitchKeepFirst",
      "modeSwitchKeepAsBatchFirst",
      "modeSwitchDiscardAll",
      "resultViewDetails",
      "summaryTotal",
    ] as const;
    for (const key of keys) {
      assert.ok(en.publicPool.quickEntry[key].length > 0, key);
      assert.ok(zhHant.publicPool.quickEntry[key].length > 0, key);
      assert.ok(zhHans.publicPool.quickEntry[key].length > 0, key);
    }
    assert.equal(en.publicPool.quickEntry.cardBadge.error, "Has errors");
    assert.equal(zhHant.publicPool.quickEntry.cardBadge.error, "有錯誤");
    assert.equal(zhHans.publicPool.quickEntry.cardBadge.error, "有错误");
  });
});
