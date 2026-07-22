"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
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
  shouldShowQuickEntryEntry,
  validateQuickEntryFormRows,
  type QuickEntryBatchSuccessView,
  type QuickEntryFormRow,
  type QuickEntryStatus,
} from "./quick-entry-ui";
import { QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE } from "@/lib/public-pool/quick-entry-customer-validation";

type Props = {
  /** Reserved for future role-specific copy; both admin and staff may use Quick Entry. */
  isAdmin?: boolean;
};

type PanelView =
  | "collapsed"
  | "verify"
  | "form"
  | "locked"
  | "disabled"
  | "results";

function errorMessageForCode(
  t: (key: string, params?: Record<string, string>) => string,
  errorCode: string,
): string {
  const mapped: Record<string, string> = {
    QUICK_ENTRY_CODE_INVALID: "publicPool.quickEntry.errors.codeInvalid",
    QUICK_ENTRY_CODE_INVALID_FORMAT: "publicPool.quickEntry.errors.codeFormat",
    QUICK_ENTRY_DISABLED: "publicPool.quickEntry.featureDisabled",
    QUICK_ENTRY_RATE_LIMITED: "publicPool.quickEntry.errors.locked",
    QUICK_ENTRY_CUSTOMER_NAME_REQUIRED:
      "publicPool.quickEntry.errors.nameRequired",
    QUICK_ENTRY_CUSTOMER_NAME_INVALID:
      "publicPool.quickEntry.errors.nameInvalid",
    QUICK_ENTRY_CONTACT_REQUIRED: "publicPool.quickEntry.errors.contactRequired",
    QUICK_ENTRY_PHONE_INVALID: "publicPool.quickEntry.errors.phoneInvalid",
    QUICK_ENTRY_PHONE_COUNTRY_CODE_INVALID:
      "publicPool.quickEntry.errors.countryCodeInvalid",
    QUICK_ENTRY_WECHAT_INVALID: "publicPool.quickEntry.errors.wechatInvalid",
    QUICK_ENTRY_PROJECT_REQUIRED: "publicPool.quickEntry.errors.projectRequired",
    QUICK_ENTRY_PROJECT_INVALID: "publicPool.quickEntry.errors.projectInvalid",
    QUICK_ENTRY_NOTE_TOO_LONG: "publicPool.quickEntry.errors.noteTooLong",
    QUICK_ENTRY_CUSTOMER_VALIDATION_FAILED:
      "publicPool.quickEntry.errors.generic",
    QUICK_ENTRY_DUPLICATE_PHONE: "publicPool.quickEntry.duplicatePhone",
    QUICK_ENTRY_DUPLICATE_WECHAT: "publicPool.quickEntry.duplicateWechat",
  };
  const key = mapped[errorCode] ?? "publicPool.quickEntry.errors.generic";
  return t(key);
}

export function StaffQuickEntryPanel(_props: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const titleId = useId();
  const codeInputId = useId();

  const [status, setStatus] = useState<QuickEntryStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("collapsed");

  const [submissionId, setSubmissionId] = useState("");
  const [rows, setRows] = useState<QuickEntryFormRow[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [batchResult, setBatchResult] =
    useState<QuickEntryBatchSuccessView | null>(null);
  const [processingRetryAfter, setProcessingRetryAfter] = useState<
    number | null
  >(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerTone, setBannerTone] = useState<"error" | "info" | null>(null);

  const submittingRef = useRef(false);
  const verifyingRef = useRef(false);

  const resetBatchInMemory = useCallback(() => {
    const batch = createNewQuickEntryBatch();
    setSubmissionId(batch.submissionId);
    setRows(batch.rows);
    setRowErrors({});
    setFormError(null);
    setBatchResult(null);
    setProcessingRetryAfter(null);
    setBanner(null);
    setBannerTone(null);
  }, []);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(false);
    try {
      const res = await fetch(QUICK_ENTRY_STATUS_API_PATH, {
        cache: "no-store",
      });
      const data = (await res.json()) as unknown;
      const parsed = parseQuickEntryStatus(data);
      if (!res.ok || !parsed.ok) {
        setStatusError(true);
        setStatus(null);
        return;
      }
      setStatus(parsed.status);
    } catch {
      setStatusError(true);
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function openPanel() {
    if (!status?.enabled && status !== null) return;
    setOpen(true);
    setVerifyCode("");
    setVerifyError(null);

    let latest = status;
    try {
      const res = await fetch(QUICK_ENTRY_STATUS_API_PATH, {
        cache: "no-store",
      });
      const data = (await res.json()) as unknown;
      const parsed = parseQuickEntryStatus(data);
      if (res.ok && parsed.ok) {
        setStatus(parsed.status);
        latest = parsed.status;
      }
    } catch {
      // keep cached status
    }

    if (!latest || !latest.enabled) {
      setView("disabled");
      return;
    }

    if (batchResult) {
      setView("results");
      return;
    }

    const mode = resolveQuickEntryPanelMode(latest).mode;
    if (mode === "locked") {
      setView("locked");
      return;
    }
    if (mode === "verify") {
      setView("verify");
      if (!submissionId) resetBatchInMemory();
      return;
    }
    if (mode === "disabled") {
      setView("disabled");
      return;
    }
    setView("form");
    if (!submissionId) resetBatchInMemory();
  }

  function closePanel() {
    if (submitting || verifying) return;
    setOpen(false);
    setView("collapsed");
    setVerifyCode("");
    setVerifyError(null);
    // Keep completed results until new batch; discard incomplete draft on close
    // by regenerating when reopening — only clear if no completed result shown.
    if (!batchResult) {
      setSubmissionId("");
      setRows([]);
      setRowErrors({});
      setFormError(null);
      setBanner(null);
      setBannerTone(null);
      setProcessingRetryAfter(null);
    }
  }

  async function handleVerify() {
    if (verifyingRef.current || verifying) return;
    if (!verifyCode) {
      setVerifyError(t("publicPool.quickEntry.verifyCodeRequired"));
      return;
    }
    verifyingRef.current = true;
    setVerifying(true);
    setVerifyError(null);
    const body = buildVerifyCodeBody(verifyCode);
    if (!isSafeVerifyBody(body)) {
      setVerifyError(t("publicPool.quickEntry.errors.generic"));
      verifyingRef.current = false;
      setVerifying(false);
      return;
    }
    try {
      const res = await fetch(QUICK_ENTRY_VERIFY_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as unknown;
      const parsed = parseVerifySuccess(data, res.ok);
      setVerifyCode("");
      if (!parsed.ok) {
        if (parsed.errorCode === "QUICK_ENTRY_RATE_LIMITED") {
          setVerifyError(
            t("publicPool.quickEntry.lockedMessage", {
              seconds: String(parsed.retryAfterSeconds ?? 0),
            }),
          );
          await loadStatus();
          setView("locked");
        } else if (parsed.errorCode === "QUICK_ENTRY_DISABLED") {
          setView("disabled");
          await loadStatus();
        } else {
          setVerifyError(
            errorMessageForCode(t, parsed.errorCode ?? "generic"),
          );
        }
        return;
      }
      await loadStatus();
      setView("form");
      if (!submissionId) resetBatchInMemory();
    } catch {
      setVerifyError(t("publicPool.quickEntry.errors.network"));
      setVerifyCode("");
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  }

  function updateRow(clientRowId: string, patch: Partial<QuickEntryFormRow>) {
    if (submitting) return;
    setRows((prev) =>
      prev.map((row) =>
        row.clientRowId === clientRowId ? { ...row, ...patch } : row,
      ),
    );
  }

  function handleAddRow() {
    if (submitting || !canAddQuickEntryRow(rows.length)) return;
    setRows((prev) => [...prev, createEmptyQuickEntryRow()]);
  }

  function handleRemoveRow(clientRowId: string) {
    if (submitting) return;
    if (!canRemoveQuickEntryRow(rows.length)) {
      setRows((prev) =>
        prev.map((row) =>
          row.clientRowId === clientRowId ? clearQuickEntryRow(row) : row,
        ),
      );
      return;
    }
    setRows((prev) => prev.filter((row) => row.clientRowId !== clientRowId));
  }

  function handleNewBatch() {
    resetBatchInMemory();
    setView("form");
    setOpen(true);
  }

  async function handleSubmit() {
    if (submittingRef.current || submitting) return;
    setBanner(null);
    setBannerTone(null);
    setProcessingRetryAfter(null);

    const validation = validateQuickEntryFormRows(rows);
    if (!validation.ok) {
      if (validation.formError === "empty") {
        setFormError(t("publicPool.quickEntry.validation.empty"));
      } else if (validation.formError === "too_many") {
        setFormError(t("publicPool.quickEntry.validation.tooMany"));
      } else if (validation.formError === "duplicate_ids") {
        setFormError(t("publicPool.quickEntry.validation.duplicateIds"));
      } else {
        setFormError(null);
      }
      const nextErrors: Record<string, string> = {};
      for (const [id, err] of Object.entries(validation.rowErrors)) {
        nextErrors[id] = t(`publicPool.quickEntry.validation.${err}`);
      }
      setRowErrors(nextErrors);
      return;
    }
    setRowErrors({});
    setFormError(null);

    const body = buildCustomersRequestBody(submissionId, rows);
    if (
      customersRequestBodyHasForbiddenKeys(body as unknown as Record<string, unknown>)
    ) {
      setBanner(t("publicPool.quickEntry.errors.generic"));
      setBannerTone("error");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(QUICK_ENTRY_CUSTOMERS_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as unknown;
      const success = parseBatchSuccessResponse(data, res.ok);
      if (success) {
        setBatchResult(success);
        setView("results");
        setBanner(
          success.replayed
            ? t("publicPool.quickEntry.replayNotice")
            : null,
        );
        setBannerTone(success.replayed ? "info" : null);
        return;
      }

      const failure = parseBatchFailureResponse(data);
      const plan = planAfterBatchFailure(failure.errorCode);
      if (plan.action === "retry_same_submission") {
        setProcessingRetryAfter(failure.retryAfterSeconds ?? null);
        setBanner(
          t("publicPool.quickEntry.processingMessage", {
            seconds: String(failure.retryAfterSeconds ?? 1),
          }),
        );
        setBannerTone("info");
        return;
      }
      if (plan.action === "require_new_batch") {
        setBanner(t("publicPool.quickEntry.idempotencyConflict"));
        setBannerTone("error");
        // Do not auto-submit; require explicit new batch (new submissionId).
        return;
      }
      if (plan.action === "require_reverify") {
        setBanner(t("publicPool.quickEntry.grantExpired"));
        setBannerTone("error");
        setView("verify");
        await loadStatus();
        return;
      }
      if (plan.action === "feature_disabled") {
        setView("disabled");
        setBanner(t("publicPool.quickEntry.featureDisabled"));
        setBannerTone("error");
        await loadStatus();
        return;
      }
      setBanner(errorMessageForCode(t, failure.errorCode));
      setBannerTone("error");
    } catch {
      setBanner(t("publicPool.quickEntry.errors.network"));
      setBannerTone("error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const entry = shouldShowQuickEntryEntry(status);

  if (statusLoading) {
    return (
      <div className="mb-6 rounded-xl border border-[#E4E9F2] bg-[var(--surface-card,white)] p-4 dark:border-[#2A3344]">
        <p className="text-sm text-[#6B7890]">
          {t("publicPool.quickEntry.loading")}
        </p>
      </div>
    );
  }

  if (statusError || !entry.visible) {
    return null;
  }

  if (entry.reason === "disabled") {
    return (
      <div className="mb-6 rounded-xl border border-dashed border-[#E4E9F2] p-4 dark:border-[#2A3344]">
        <p className="text-sm text-[#6B7890]">
          {t("publicPool.quickEntry.featureDisabledSubtle")}
        </p>
      </div>
    );
  }

  const resultsById = batchResult
    ? mapResultsByClientRowId(batchResult.results)
    : null;

  return (
    <>
      <div className="mb-6 rounded-xl border border-[#E4E9F2] bg-[var(--surface-card,white)] p-4 dark:border-[#2A3344]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3
              id={titleId}
              className="text-sm font-semibold text-[#172033]"
            >
              {t("publicPool.quickEntry.entryTitle")}
            </h3>
            <p className="mt-1 text-sm text-[#6B7890]">
              {t("publicPool.quickEntry.entryDescription")}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="inline-flex w-full sm:w-auto"
            onClick={() => void openPanel()}
          >
            {t("publicPool.quickEntry.openButton")}
          </Button>
        </div>
      </div>

      {open ? (
        <ModalOverlay onClose={submitting || verifying ? undefined : closePanel}>
          <ModalPanel className="max-h-[90vh] w-full overflow-y-auto sm:max-w-2xl">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="pb-[env(safe-area-inset-bottom)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-medium text-[#172033]">
                  {t("publicPool.quickEntry.panelTitle")}
                </h3>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={submitting || verifying}
                  onClick={closePanel}
                >
                  {t("publicPool.quickEntry.close")}
                </Button>
              </div>

              {banner ? (
                <p
                  className={`mt-3 text-sm ${
                    bannerTone === "error" ? "text-red-600" : "text-[#6B7890]"
                  }`}
                  role={bannerTone === "error" ? "alert" : "status"}
                >
                  {banner}
                </p>
              ) : null}

              {view === "locked" && status ? (
                <div className="mt-4">
                  <p className="text-sm text-[#6B7890]" role="status">
                    {t("publicPool.quickEntry.lockedMessage", {
                      seconds: String(status.retryAfterSeconds ?? 0),
                    })}
                  </p>
                </div>
              ) : null}

              {view === "disabled" ? (
                <p className="mt-4 text-sm text-[#6B7890]">
                  {t("publicPool.quickEntry.featureDisabled")}
                </p>
              ) : null}

              {view === "verify" ? (
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-[#6B7890]">
                    {t("publicPool.quickEntry.verifyHint")}
                  </p>
                  <div>
                    <Label htmlFor={codeInputId}>
                      {t("publicPool.quickEntry.verifyCodeLabel")}
                    </Label>
                    <Input
                      id={codeInputId}
                      type="password"
                      autoComplete="off"
                      value={verifyCode}
                      disabled={verifying}
                      onChange={(e) => setVerifyCode(e.target.value)}
                    />
                  </div>
                  {verifyError ? (
                    <p className="text-sm text-red-600" role="alert">
                      {verifyError}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    className="w-full sm:w-auto"
                    disabled={verifying}
                    onClick={() => void handleVerify()}
                  >
                    {verifying
                      ? t("publicPool.quickEntry.verifying")
                      : t("publicPool.quickEntry.verifySubmit")}
                  </Button>
                </div>
              ) : null}

              {(view === "form" || view === "results") && rows.length > 0 ? (
                <div className="mt-4 space-y-4">
                  {batchResult ? (
                    <div className="rounded-lg border border-[#E4E9F2] bg-[#FAFBFD] p-3 text-sm dark:border-[#2A3344]">
                      <p className="font-medium text-[#172033]">
                        {t("publicPool.quickEntry.summaryTitle")}
                      </p>
                      <p className="mt-1 text-[#6B7890]">
                        {t("publicPool.quickEntry.summaryLine", {
                          total: String(batchResult.summary.total),
                          created: String(batchResult.summary.created),
                          duplicates: String(batchResult.summary.duplicates),
                          invalid: String(batchResult.summary.invalid),
                          failed: String(batchResult.summary.failed),
                        })}
                      </p>
                      <p className="mt-2 text-xs text-[#6B7890]">
                        {t("publicPool.quickEntry.reviseNeedsNewBatch")}
                      </p>
                    </div>
                  ) : null}

                  {formError ? (
                    <p className="text-sm text-red-600" role="alert">
                      {formError}
                    </p>
                  ) : null}

                  <ul className="space-y-4">
                    {rows.map((row, index) => {
                      const result = resultsById?.get(row.clientRowId) ?? null;
                      const fieldDisabled = submitting || view === "results";
                      return (
                        <li
                          key={row.clientRowId}
                          className="rounded-xl border border-[#E4E9F2] p-4 dark:border-[#2A3344]"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-[#172033]">
                              {t("publicPool.quickEntry.rowLabel", {
                                n: String(index + 1),
                              })}
                            </p>
                            {result ? (
                              <Badge
                                variant={
                                  result.status === "created"
                                    ? "success"
                                    : result.status === "duplicate"
                                      ? "warning"
                                      : "default"
                                }
                              >
                                {t(
                                  `publicPool.quickEntry.status.${result.status}`,
                                )}
                              </Badge>
                            ) : null}
                          </div>

                          {result?.status === "created" ? (
                            <p className="mb-3 text-sm text-[#6B7890]">
                              {t("publicPool.quickEntry.createdDetail", {
                                code: result.customerCode,
                                name: result.customerName,
                              })}
                            </p>
                          ) : null}
                          {result?.status === "duplicate" ? (
                            <p className="mb-3 text-sm text-[#6B7890]">
                              {t(
                                result.duplicateField === "wechatId"
                                  ? "publicPool.quickEntry.duplicateWechat"
                                  : "publicPool.quickEntry.duplicatePhone",
                              )}
                            </p>
                          ) : null}
                          {result?.status === "invalid" ||
                          result?.status === "failed" ? (
                            <p className="mb-3 text-sm text-red-600" role="alert">
                              {errorMessageForCode(t, result.errorCode)}
                            </p>
                          ) : null}

                          <div className="grid gap-3">
                            <div>
                              <Label htmlFor={`${row.clientRowId}-name`}>
                                {t("publicPool.quickEntry.fields.customerName")}
                              </Label>
                              <Input
                                id={`${row.clientRowId}-name`}
                                value={row.customerName}
                                disabled={fieldDisabled}
                                aria-invalid={Boolean(rowErrors[row.clientRowId])}
                                onChange={(e) =>
                                  updateRow(row.clientRowId, {
                                    customerName: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <Label
                                  htmlFor={`${row.clientRowId}-country`}
                                >
                                  {t(
                                    "publicPool.quickEntry.fields.phoneCountryCode",
                                  )}
                                </Label>
                                <Input
                                  id={`${row.clientRowId}-country`}
                                  value={QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE}
                                  readOnly
                                  disabled
                                  aria-readonly="true"
                                />
                                <p className="mt-1 text-xs text-[#6B7890]">
                                  {t(
                                    "publicPool.quickEntry.fields.phoneCountryCodeFixedHint",
                                  )}
                                </p>
                              </div>
                              <div>
                                <Label htmlFor={`${row.clientRowId}-phone`}>
                                  {t("publicPool.quickEntry.fields.phone")}
                                </Label>
                                <Input
                                  id={`${row.clientRowId}-phone`}
                                  type="tel"
                                  inputMode="numeric"
                                  maxLength={11}
                                  autoComplete="tel-national"
                                  placeholder={t(
                                    "publicPool.quickEntry.fields.phonePlaceholder",
                                  )}
                                  value={row.phone}
                                  disabled={fieldDisabled}
                                  onChange={(e) =>
                                    updateRow(row.clientRowId, {
                                      phone: e.target.value,
                                    })
                                  }
                                />
                              </div>
                            </div>
                            <div>
                              <Label htmlFor={`${row.clientRowId}-wechat`}>
                                {t("publicPool.quickEntry.fields.wechatId")}
                              </Label>
                              <Input
                                id={`${row.clientRowId}-wechat`}
                                value={row.wechatId}
                                disabled={fieldDisabled}
                                onChange={(e) =>
                                  updateRow(row.clientRowId, {
                                    wechatId: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={`${row.clientRowId}-project`}>
                                {t(
                                  "publicPool.quickEntry.fields.requestedProjectName",
                                )}
                              </Label>
                              <Input
                                id={`${row.clientRowId}-project`}
                                value={row.requestedProjectName}
                                disabled={fieldDisabled}
                                onChange={(e) =>
                                  updateRow(row.clientRowId, {
                                    requestedProjectName: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={`${row.clientRowId}-followup`}>
                                {t(
                                  "publicPool.quickEntry.fields.initialFollowUpNote",
                                )}
                              </Label>
                              <Textarea
                                id={`${row.clientRowId}-followup`}
                                value={row.initialFollowUpNote}
                                disabled={fieldDisabled}
                                onChange={(e) =>
                                  updateRow(row.clientRowId, {
                                    initialFollowUpNote: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={`${row.clientRowId}-note`}>
                                {t(
                                  "publicPool.quickEntry.fields.supplementalNote",
                                )}
                              </Label>
                              <Textarea
                                id={`${row.clientRowId}-note`}
                                value={row.supplementalNote}
                                disabled={fieldDisabled}
                                onChange={(e) =>
                                  updateRow(row.clientRowId, {
                                    supplementalNote: e.target.value,
                                  })
                                }
                              />
                            </div>
                            {rowErrors[row.clientRowId] ? (
                              <p
                                className="text-sm text-red-600"
                                role="alert"
                              >
                                {rowErrors[row.clientRowId]}
                              </p>
                            ) : null}
                          </div>

                          {view === "form" ? (
                            <div className="mt-3">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={submitting}
                                onClick={() => handleRemoveRow(row.clientRowId)}
                              >
                                {canRemoveQuickEntryRow(rows.length)
                                  ? t("publicPool.quickEntry.removeRow")
                                  : t("publicPool.quickEntry.clearRow")}
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  {view === "form" ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        disabled={
                          submitting || !canAddQuickEntryRow(rows.length)
                        }
                        onClick={handleAddRow}
                      >
                        {t("publicPool.quickEntry.addRow", {
                          max: String(QUICK_ENTRY_UI_MAX_ROWS),
                        })}
                      </Button>
                      <Button
                        type="button"
                        className="w-full sm:w-auto"
                        disabled={submitting}
                        onClick={() => void handleSubmit()}
                      >
                        {submitting
                          ? t("publicPool.quickEntry.submitting")
                          : t("publicPool.quickEntry.submit")}
                      </Button>
                      {processingRetryAfter != null ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full sm:w-auto"
                          disabled={submitting}
                          onClick={() => void handleSubmit()}
                        >
                          {t("publicPool.quickEntry.retryLater")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {view === "results" ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                      <Button
                        type="button"
                        className="w-full sm:w-auto"
                        onClick={handleNewBatch}
                      >
                        {t("publicPool.quickEntry.newBatch")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        onClick={() => {
                          router.refresh();
                          closePanel();
                        }}
                      >
                        {t("publicPool.quickEntry.refreshPool")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        onClick={closePanel}
                      >
                        {t("publicPool.quickEntry.close")}
                      </Button>
                    </div>
                  ) : null}

                  {banner &&
                  bannerTone === "error" &&
                  view === "form" &&
                  processingRetryAfter == null ? (
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        disabled={submitting}
                        onClick={() => void handleSubmit()}
                      >
                        {t("publicPool.quickEntry.retry")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        disabled={submitting}
                        onClick={handleNewBatch}
                      >
                        {t("publicPool.quickEntry.newBatch")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </ModalPanel>
        </ModalOverlay>
      ) : null}
    </>
  );
}
