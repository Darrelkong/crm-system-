"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { QuickEntryDrawer } from "@/components/ui/quick-entry-drawer";
import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE } from "@/lib/public-pool/quick-entry-customer-validation";
import {
  QUICK_ENTRY_CUSTOMERS_API_PATH,
  QUICK_ENTRY_PROJECT_SUGGESTIONS,
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
  deriveSingleEntryResultKind,
  filterProjectSuggestions,
  firstFieldErrorKey,
  isQuickEntryBatchDirty,
  isSafeVerifyBody,
  mapResultsByClientRowId,
  parseBatchFailureResponse,
  parseBatchSuccessResponse,
  parseQuickEntryStatus,
  parseVerifySuccess,
  planAfterBatchFailure,
  prepareContinueEntryRow,
  resolveQuickEntryPanelMode,
  shouldShowQuickEntryEntry,
  validateQuickEntryFormRows,
  type QuickEntryBatchSuccessView,
  type QuickEntryEntryMode,
  type QuickEntryFieldErrors,
  type QuickEntryFieldKey,
  type QuickEntryFormRow,
  type QuickEntryRowResultView,
  type QuickEntryStatus,
} from "./quick-entry-ui";

type Props = {
  isAdmin?: boolean;
};

type PanelView =
  | "collapsed"
  | "verify"
  | "form"
  | "locked"
  | "disabled"
  | "results";

type SubmitIntent = "done" | "continue" | "batch";

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
  return t(mapped[errorCode] ?? "publicPool.quickEntry.errors.generic");
}

function fieldDomId(rowId: string, field: QuickEntryFieldKey): string {
  if (field === "customerName") return `${rowId}-name`;
  if (field === "requestedProjectName") return `${rowId}-project`;
  if (field === "phone" || field === "contact") return `${rowId}-phone`;
  return `${rowId}-wechat`;
}

export function StaffQuickEntryPanel(_props: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const titleId = useId();
  const drawerTitleId = useId();
  const codeInputId = useId();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<QuickEntryStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("collapsed");
  const [entryMode, setEntryMode] = useState<QuickEntryEntryMode>("single");
  const [submissionId, setSubmissionId] = useState("");
  const [rows, setRows] = useState<QuickEntryFormRow[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [fieldErrorsByRow, setFieldErrorsByRow] = useState<
    Record<string, QuickEntryFieldErrors>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [batchResult, setBatchResult] =
    useState<QuickEntryBatchSuccessView | null>(null);
  const [processingRetryAfter, setProcessingRetryAfter] = useState<number | null>(
    null,
  );
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerTone, setBannerTone] = useState<
    "error" | "info" | "success" | null
  >(null);
  const [keepProject, setKeepProject] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [projectComboOpen, setProjectComboOpen] = useState(false);
  const [projectHighlight, setProjectHighlight] = useState(0);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [sessionCreatedCount, setSessionCreatedCount] = useState(0);
  const [draftSnapshot, setDraftSnapshot] = useState<QuickEntryFormRow | null>(
    null,
  );

  const submittingRef = useRef(false);
  const verifyingRef = useRef(false);
  const submitIntentRef = useRef<SubmitIntent>("done");

  const resetBatchInMemory = useCallback(() => {
    const batch = createNewQuickEntryBatch();
    setSubmissionId(batch.submissionId);
    setRows(batch.rows);
    setRowErrors({});
    setFieldErrorsByRow({});
    setFormError(null);
    setBatchResult(null);
    setProcessingRetryAfter(null);
    setBanner(null);
    setBannerTone(null);
    setNoteOpen(false);
    setProjectComboOpen(false);
    setDraftSnapshot(null);
  }, []);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(false);
    try {
      const res = await fetch(QUICK_ENTRY_STATUS_API_PATH, { cache: "no-store" });
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

  function focusField(rowId: string, field: QuickEntryFieldKey | null) {
    if (!field) return;
    const el = document.getElementById(fieldDomId(rowId, field));
    if (el instanceof HTMLElement) el.focus();
  }

  function applyClientValidation(
    validation: ReturnType<typeof validateQuickEntryFormRows>,
  ) {
    if (validation.ok) {
      setRowErrors({});
      setFieldErrorsByRow({});
      setFormError(null);
      return;
    }
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
    setFieldErrorsByRow(validation.fieldErrors);
    const firstRowId = Object.keys(validation.fieldErrors)[0];
    if (firstRowId) {
      focusField(
        firstRowId,
        firstFieldErrorKey(validation.fieldErrors[firstRowId]),
      );
    }
  }

  async function openPanel() {
    if (!status?.enabled && status !== null) return;
    setOpen(true);
    setVerifyCode("");
    setVerifyError(null);
    setDiscardOpen(false);
    setEntryMode("single");

    let latest = status;
    try {
      const res = await fetch(QUICK_ENTRY_STATUS_API_PATH, { cache: "no-store" });
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
      if (batchResult.summary.total > 1) setEntryMode("batch");
      else setEntryMode("single");
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

  function closePanelForce() {
    setOpen(false);
    setView("collapsed");
    setVerifyCode("");
    setVerifyError(null);
    setDiscardOpen(false);
    setProjectComboOpen(false);
    if (!batchResult) {
      setSubmissionId("");
      setRows([]);
      setRowErrors({});
      setFieldErrorsByRow({});
      setFormError(null);
      setBanner(null);
      setBannerTone(null);
      setProcessingRetryAfter(null);
      setNoteOpen(false);
      setDraftSnapshot(null);
    }
  }

  function requestClose() {
    if (submitting || verifying) return;
    if (view === "form" && isQuickEntryBatchDirty(rows)) {
      setDiscardOpen(true);
      return;
    }
    closePanelForce();
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
          setVerifyError(errorMessageForCode(t, parsed.errorCode ?? "generic"));
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
    if (submitting || view === "results") return;
    setRows((prev) =>
      prev.map((row) =>
        row.clientRowId === clientRowId ? { ...row, ...patch } : row,
      ),
    );
    setFieldErrorsByRow((prev) => {
      if (!prev[clientRowId]) return prev;
      const next = { ...prev };
      delete next[clientRowId];
      return next;
    });
    setRowErrors((prev) => {
      if (!prev[clientRowId]) return prev;
      const next = { ...prev };
      delete next[clientRowId];
      return next;
    });
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

  function beginContinueAfterSuccess(previousRow: QuickEntryFormRow) {
    const batch = createNewQuickEntryBatch();
    const nextRow = prepareContinueEntryRow(previousRow, keepProject);
    setSubmissionId(batch.submissionId);
    setRows([nextRow]);
    setBatchResult(null);
    setDraftSnapshot(null);
    setRowErrors({});
    setFieldErrorsByRow({});
    setFormError(null);
    setProcessingRetryAfter(null);
    setNoteOpen(false);
    setProjectComboOpen(false);
    setView("form");
    setBanner(t("publicPool.quickEntry.toastContinueSuccess"));
    setBannerTone("success");
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }

  function switchEntryMode(next: QuickEntryEntryMode) {
    if (submitting || view !== "form") return;
    if (next === "single" && rows.length > 1) {
      setRows((prev) => (prev[0] ? [prev[0]] : [createEmptyQuickEntryRow()]));
    }
    if (next === "batch" && rows.length === 0) {
      setRows([createEmptyQuickEntryRow()]);
    }
    setEntryMode(next);
    setFieldErrorsByRow({});
    setRowErrors({});
    setFormError(null);
    setBanner(null);
    setBannerTone(null);
  }

  async function handleSubmit(intent: SubmitIntent = "done") {
    if (submittingRef.current || submitting) return;
    submitIntentRef.current = intent;
    setBanner(null);
    setBannerTone(null);
    setProcessingRetryAfter(null);

    const submitRows =
      intent === "batch" || entryMode === "batch" ? rows : rows.slice(0, 1);
    const validation = validateQuickEntryFormRows(submitRows);
    if (!validation.ok) {
      applyClientValidation(validation);
      return;
    }
    setRowErrors({});
    setFieldErrorsByRow({});
    setFormError(null);

    const body = buildCustomersRequestBody(submissionId, submitRows);
    if (
      customersRequestBodyHasForbiddenKeys(
        body as unknown as Record<string, unknown>,
      )
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
        if (success.summary.created > 0) {
          setSessionCreatedCount((n) => n + success.summary.created);
        }
        const singleResult = success.results[0];
        const isContinue =
          intent === "continue" &&
          entryMode === "single" &&
          singleResult?.status === "created";
        if (isContinue) {
          beginContinueAfterSuccess(submitRows[0]!);
          return;
        }
        setBatchResult(success);
        setDraftSnapshot(submitRows[0] ?? null);
        setView("results");
        setBanner(
          success.replayed ? t("publicPool.quickEntry.replayNotice") : null,
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

  function handleBackToEdit() {
    const previous = draftSnapshot ?? rows[0] ?? createEmptyQuickEntryRow();
    const batch = createNewQuickEntryBatch();
    const restored: QuickEntryFormRow = {
      ...previous,
      clientRowId: batch.rows[0]!.clientRowId,
      phoneCountryCode: QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE,
    };
    setSubmissionId(batch.submissionId);
    setRows([restored]);
    setBatchResult(null);
    setDraftSnapshot(null);
    setView("form");
    setEntryMode("single");
    setBanner(null);
    setBannerTone(null);
    const validation = validateQuickEntryFormRows([restored]);
    if (!validation.ok) applyClientValidation(validation);
    else setTimeout(() => nameInputRef.current?.focus(), 0);
  }

  function onFormKeyDown(event: ReactKeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    if (view !== "form" || submitting) return;
    event.preventDefault();
    void handleSubmit(entryMode === "single" ? "done" : "batch");
  }

  const entry = shouldShowQuickEntryEntry(status);
  if (statusLoading) {
    return (
      <div className="mb-6 rounded-xl border border-[var(--color-crm-border)] bg-[var(--color-crm-card)] p-4">
        <p className="text-sm text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.loading")}
        </p>
      </div>
    );
  }
  if (statusError || !entry.visible) return null;
  if (entry.reason === "disabled") {
    return (
      <div className="mb-6 rounded-xl border border-dashed border-[var(--color-crm-border)] p-4">
        <p className="text-sm text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.featureDisabledSubtle")}
        </p>
      </div>
    );
  }

  const resultsById = batchResult
    ? mapResultsByClientRowId(batchResult.results)
    : null;
  const singleRow = rows[0] ?? null;
  const singleResult = batchResult?.results[0] ?? null;
  const singleKind =
    entryMode === "single" ? deriveSingleEntryResultKind(singleResult) : null;
  const singleFieldErrors = singleRow
    ? fieldErrorsByRow[singleRow.clientRowId]
    : undefined;
  const projectSuggestions = filterProjectSuggestions(
    singleRow?.requestedProjectName ?? "",
  );
  const otherLabel = t("publicPool.quickEntry.projectOtherOption");

  const modeTabs =
    view === "form" ? (
      <div
        className="qe-mode-tabs"
        role="tablist"
        aria-label={t("publicPool.quickEntry.panelTitle")}
      >
        <button
          type="button"
          role="tab"
          className="qe-mode-tab"
          aria-selected={entryMode === "single"}
          disabled={submitting}
          onClick={() => switchEntryMode("single")}
        >
          {t("publicPool.quickEntry.modeSingle")}
        </button>
        <button
          type="button"
          role="tab"
          className="qe-mode-tab"
          aria-selected={entryMode === "batch"}
          disabled={submitting}
          onClick={() => switchEntryMode("batch")}
        >
          {t("publicPool.quickEntry.modeBatch")}
        </button>
      </div>
    ) : null;

  const footer =
    view === "form" && entryMode === "single" ? (
      <div className="flex w-full flex-col gap-3">
        <label className="qe-switch-row">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-crm-primary)]"
            checked={keepProject}
            disabled={submitting}
            onChange={(e) => setKeepProject(e.target.checked)}
          />
          <span>{t("publicPool.quickEntry.keepProject")}</span>
        </label>
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={requestClose}
          >
            {t("publicPool.quickEntry.cancel")}
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => void handleSubmit("continue")}
            >
              {submitting && submitIntentRef.current === "continue"
                ? t("publicPool.quickEntry.submitting")
                : t("publicPool.quickEntry.saveContinue")}
            </Button>
            <Button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmit("done")}
            >
              {submitting && submitIntentRef.current === "done"
                ? t("publicPool.quickEntry.submitting")
                : t("publicPool.quickEntry.saveDone")}
            </Button>
          </div>
        </div>
      </div>
    ) : view === "form" && entryMode === "batch" ? (
      <div className="flex w-full flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          onClick={requestClose}
        >
          {t("publicPool.quickEntry.cancel")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={submitting || !canAddQuickEntryRow(rows.length)}
          onClick={handleAddRow}
        >
          {t("publicPool.quickEntry.addRow", {
            max: String(QUICK_ENTRY_UI_MAX_ROWS),
          })}
        </Button>
        <Button
          type="button"
          className="ml-auto"
          disabled={submitting}
          onClick={() => void handleSubmit("batch")}
        >
          {submitting
            ? t("publicPool.quickEntry.submitting")
            : t("publicPool.quickEntry.submit")}
        </Button>
        {processingRetryAfter != null ? (
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => void handleSubmit("batch")}
          >
            {t("publicPool.quickEntry.retryLater")}
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <div className="mb-6 rounded-xl border border-[var(--color-crm-border)] bg-[var(--color-crm-card)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3
              id={titleId}
              className="text-sm font-semibold text-[var(--color-crm-text)]"
            >
              {t("publicPool.quickEntry.entryTitle")}
            </h3>
            <p className="mt-1 text-sm text-[var(--color-crm-text-secondary)]">
              {t("publicPool.quickEntry.entryDescription")}
            </p>
            {sessionCreatedCount > 0 ? (
              <p className="mt-1 text-xs text-[var(--color-crm-text-secondary)]">
                {t("publicPool.quickEntry.sessionCreatedCount", {
                  count: String(sessionCreatedCount),
                })}
              </p>
            ) : null}
          </div>
          <button
            ref={openButtonRef}
            type="button"
            className="secondary-button inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium sm:w-auto"
            onClick={() => void openPanel()}
          >
            {t("publicPool.quickEntry.openButton")}
          </button>
        </div>
      </div>

      <QuickEntryDrawer
        open={open}
        title={t("publicPool.quickEntry.panelTitle")}
        description={t("publicPool.quickEntry.panelDescription")}
        onRequestClose={requestClose}
        closeBlocked={submitting || verifying}
        closeLabel={t("publicPool.quickEntry.close")}
        headerExtra={modeTabs}
        footer={footer}
        returnFocusRef={openButtonRef}
        labelledById={drawerTitleId}
      >
        <div onKeyDown={onFormKeyDown}>
          {banner ? (
            <p
              className={cn(
                "mb-3 text-sm",
                bannerTone === "error" && "text-red-600",
                bannerTone === "success" &&
                  "text-emerald-700 dark:text-emerald-400",
                (bannerTone === "info" || !bannerTone) &&
                  "text-[var(--color-crm-text-secondary)]",
              )}
              role={bannerTone === "error" ? "alert" : "status"}
            >
              {banner}
            </p>
          ) : null}

          {submitting ? (
            <p
              className="mb-3 text-sm text-[var(--color-crm-text-secondary)]"
              role="status"
            >
              {t("publicPool.quickEntry.closeBlockedHint")}
            </p>
          ) : null}

          {view === "locked" && status ? (
            <p
              className="text-sm text-[var(--color-crm-text-secondary)]"
              role="status"
            >
              {t("publicPool.quickEntry.lockedMessage", {
                seconds: String(status.retryAfterSeconds ?? 0),
              })}
            </p>
          ) : null}

          {view === "disabled" ? (
            <p className="text-sm text-[var(--color-crm-text-secondary)]">
              {t("publicPool.quickEntry.featureDisabled")}
            </p>
          ) : null}

          {view === "verify" ? (
            <VerifyBlock
              codeInputId={codeInputId}
              verifyCode={verifyCode}
              setVerifyCode={setVerifyCode}
              verifyError={verifyError}
              verifying={verifying}
              onVerify={() => void handleVerify()}
              t={t}
            />
          ) : null}

          {view === "form" && entryMode === "single" && singleRow ? (
            <SingleEntryForm
              row={singleRow}
              fieldErrors={singleFieldErrors}
              noteOpen={noteOpen}
              setNoteOpen={setNoteOpen}
              projectComboOpen={projectComboOpen}
              setProjectComboOpen={setProjectComboOpen}
              projectHighlight={projectHighlight}
              setProjectHighlight={setProjectHighlight}
              projectSuggestions={projectSuggestions}
              otherLabel={otherLabel}
              submitting={submitting}
              nameInputRef={nameInputRef}
              updateRow={updateRow}
              t={t}
            />
          ) : null}

          {view === "form" && entryMode === "batch" && rows.length > 0 ? (
            <BatchEntryForm
              rows={rows}
              rowErrors={rowErrors}
              formError={formError}
              submitting={submitting}
              updateRow={updateRow}
              handleRemoveRow={handleRemoveRow}
              banner={banner}
              bannerTone={bannerTone}
              processingRetryAfter={processingRetryAfter}
              handleSubmit={() => void handleSubmit("batch")}
              handleNewBatch={handleNewBatch}
              t={t}
            />
          ) : null}

          {view === "results" && batchResult && entryMode === "single" ? (
            <SingleResultView
              kind={singleKind}
              result={singleResult}
              draft={draftSnapshot ?? singleRow}
              onContinue={() => {
                beginContinueAfterSuccess(
                  draftSnapshot ?? singleRow ?? createEmptyQuickEntryRow(),
                );
              }}
              onBackEdit={handleBackToEdit}
              onNewBatch={handleNewBatch}
              onViewPool={() => {
                router.refresh();
                closePanelForce();
              }}
              onClose={closePanelForce}
              t={t}
              mapError={(code) => errorMessageForCode(t, code)}
            />
          ) : null}

          {view === "results" && batchResult && entryMode === "batch" ? (
            <BatchResultsView
              batchResult={batchResult}
              rows={rows}
              resultsById={resultsById}
              onNewBatch={handleNewBatch}
              onViewPool={() => {
                router.refresh();
                closePanelForce();
              }}
              onClose={closePanelForce}
              t={t}
              mapError={(code) => errorMessageForCode(t, code)}
            />
          ) : null}
        </div>
      </QuickEntryDrawer>

      {discardOpen ? (
        <ModalOverlay onClose={() => setDiscardOpen(false)}>
          <ModalPanel className="sm:max-w-md">
            <h3 className="text-lg font-medium text-[var(--color-crm-text)]">
              {t("publicPool.quickEntry.discardTitle")}
            </h3>
            <p className="mt-2 text-sm text-[var(--color-crm-text-secondary)]">
              {t("publicPool.quickEntry.discardDescription")}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDiscardOpen(false)}
              >
                {t("publicPool.quickEntry.discardCancel")}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setDiscardOpen(false);
                  closePanelForce();
                }}
              >
                {t("publicPool.quickEntry.discardConfirm")}
              </Button>
            </div>
          </ModalPanel>
        </ModalOverlay>
      ) : null}
    </>
  );
}

type TFn = (key: string, params?: Record<string, string>) => string;

function VerifyBlock({
  codeInputId,
  verifyCode,
  setVerifyCode,
  verifyError,
  verifying,
  onVerify,
  t,
}: {
  codeInputId: string;
  verifyCode: string;
  setVerifyCode: (v: string) => void;
  verifyError: string | null;
  verifying: boolean;
  onVerify: () => void;
  t: TFn;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-crm-text-secondary)]">
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
      <Button type="button" disabled={verifying} onClick={onVerify}>
        {verifying
          ? t("publicPool.quickEntry.verifying")
          : t("publicPool.quickEntry.verifySubmit")}
      </Button>
    </div>
  );
}

function PhoneField({
  id,
  value,
  disabled,
  invalid,
  describedBy,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={cn("qe-phone-wrap", invalid && "is-invalid")}>
      <span className="qe-phone-prefix" aria-hidden="true">
        {QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE}
      </span>
      <input
        type="text"
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        value={QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE}
        className="sr-only"
      />
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        maxLength={11}
        autoComplete="tel-national"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SingleEntryForm({
  row,
  fieldErrors,
  noteOpen,
  setNoteOpen,
  projectComboOpen,
  setProjectComboOpen,
  projectHighlight,
  setProjectHighlight,
  projectSuggestions,
  otherLabel,
  submitting,
  nameInputRef,
  updateRow,
  t,
}: {
  row: QuickEntryFormRow;
  fieldErrors?: QuickEntryFieldErrors;
  noteOpen: boolean;
  setNoteOpen: (open: boolean) => void;
  projectComboOpen: boolean;
  setProjectComboOpen: (open: boolean) => void;
  projectHighlight: number;
  setProjectHighlight: (n: number) => void;
  projectSuggestions: string[];
  otherLabel: string;
  submitting: boolean;
  nameInputRef: RefObject<HTMLInputElement | null>;
  updateRow: (id: string, patch: Partial<QuickEntryFormRow>) => void;
  t: TFn;
}) {
  const phoneInvalid = Boolean(fieldErrors?.phone || fieldErrors?.contact);
  const suggestions =
    projectSuggestions.length > 0
      ? projectSuggestions
      : [...QUICK_ENTRY_PROJECT_SUGGESTIONS];

  function pickProject(value: string) {
    const isOther = value === "其他" || value === otherLabel;
    updateRow(row.clientRowId, {
      requestedProjectName: isOther ? "" : value,
    });
    setProjectComboOpen(false);
  }

  function onProjectKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (
      !projectComboOpen &&
      (event.key === "ArrowDown" || event.key === "Enter")
    ) {
      setProjectComboOpen(true);
      return;
    }
    if (!projectComboOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setProjectHighlight((projectHighlight + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setProjectHighlight(
        (projectHighlight - 1 + suggestions.length) % suggestions.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = suggestions[projectHighlight];
      if (picked) pickProject(picked);
    } else if (event.key === "Escape") {
      setProjectComboOpen(false);
    }
  }

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor={`${row.clientRowId}-name`}>
            {t("publicPool.quickEntry.fields.customerName")}
          </Label>
          <Input
            ref={nameInputRef}
            id={`${row.clientRowId}-name`}
            value={row.customerName}
            disabled={submitting}
            aria-invalid={Boolean(fieldErrors?.customerName)}
            aria-describedby={
              fieldErrors?.customerName ? `${row.clientRowId}-name-err` : undefined
            }
            onChange={(e) =>
              updateRow(row.clientRowId, { customerName: e.target.value })
            }
          />
          {fieldErrors?.customerName ? (
            <p
              id={`${row.clientRowId}-name-err`}
              className="qe-field-error"
              role="alert"
            >
              {t(`publicPool.quickEntry.validation.${fieldErrors.customerName}`)}
            </p>
          ) : null}
        </div>
        <div>
          <Label htmlFor={`${row.clientRowId}-project`}>
            {t("publicPool.quickEntry.fields.requestedProjectName")}
          </Label>
          <div className="qe-combo">
            <Input
              id={`${row.clientRowId}-project`}
              value={row.requestedProjectName}
              disabled={submitting}
              placeholder={t("publicPool.quickEntry.projectSearchPlaceholder")}
              aria-invalid={Boolean(fieldErrors?.requestedProjectName)}
              aria-autocomplete="list"
              aria-expanded={projectComboOpen}
              aria-describedby={
                fieldErrors?.requestedProjectName
                  ? `${row.clientRowId}-project-err`
                  : undefined
              }
              onFocus={() => setProjectComboOpen(true)}
              onChange={(e) => {
                updateRow(row.clientRowId, {
                  requestedProjectName: e.target.value,
                });
                setProjectComboOpen(true);
                setProjectHighlight(0);
              }}
              onKeyDown={onProjectKeyDown}
              onBlur={() => {
                setTimeout(() => setProjectComboOpen(false), 120);
              }}
            />
            {projectComboOpen ? (
              <ul className="qe-combo-list" role="listbox">
                {suggestions.map((item, index) => (
                  <li key={item}>
                    <button
                      type="button"
                      role="option"
                      className="qe-combo-item"
                      aria-selected={index === projectHighlight}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickProject(item)}
                    >
                      {item === "其他" ? otherLabel : item}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[var(--color-crm-text-secondary)]">
            {t("publicPool.quickEntry.projectOtherHint")}
          </p>
          {fieldErrors?.requestedProjectName ? (
            <p
              id={`${row.clientRowId}-project-err`}
              className="qe-field-error"
              role="alert"
            >
              {t(
                `publicPool.quickEntry.validation.${fieldErrors.requestedProjectName}`,
              )}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor={`${row.clientRowId}-phone`}>
            {t("publicPool.quickEntry.fields.phone")}
          </Label>
          <PhoneField
            id={`${row.clientRowId}-phone`}
            value={row.phone}
            disabled={submitting}
            invalid={phoneInvalid}
            describedBy={phoneInvalid ? `${row.clientRowId}-phone-err` : undefined}
            placeholder={t("publicPool.quickEntry.fields.phonePlaceholder")}
            onChange={(phone) => updateRow(row.clientRowId, { phone })}
          />
          {fieldErrors?.phone ? (
            <p
              id={`${row.clientRowId}-phone-err`}
              className="qe-field-error"
              role="alert"
            >
              {t(`publicPool.quickEntry.validation.${fieldErrors.phone}`)}
            </p>
          ) : null}
          {fieldErrors?.contact && !fieldErrors?.phone ? (
            <p
              id={`${row.clientRowId}-phone-err`}
              className="qe-field-error"
              role="alert"
            >
              {t(`publicPool.quickEntry.validation.${fieldErrors.contact}`)}
            </p>
          ) : null}
        </div>
        <div>
          <Label htmlFor={`${row.clientRowId}-wechat`}>
            {t("publicPool.quickEntry.fields.wechatId")}
          </Label>
          <Input
            id={`${row.clientRowId}-wechat`}
            value={row.wechatId}
            disabled={submitting}
            onChange={(e) =>
              updateRow(row.clientRowId, { wechatId: e.target.value })
            }
          />
        </div>
      </div>

      <div>
        <Label htmlFor={`${row.clientRowId}-followup`}>
          {t("publicPool.quickEntry.fields.initialFollowUpNote")}
        </Label>
        <Textarea
          id={`${row.clientRowId}-followup`}
          className="min-h-[88px]"
          value={row.initialFollowUpNote}
          disabled={submitting}
          onChange={(e) =>
            updateRow(row.clientRowId, { initialFollowUpNote: e.target.value })
          }
        />
      </div>

      {noteOpen ? (
        <div>
          <Label htmlFor={`${row.clientRowId}-note`}>
            {t("publicPool.quickEntry.fields.supplementalNote")}
          </Label>
          <Textarea
            id={`${row.clientRowId}-note`}
            className="min-h-[80px]"
            value={row.supplementalNote}
            disabled={submitting}
            onChange={(e) =>
              updateRow(row.clientRowId, { supplementalNote: e.target.value })
            }
          />
          <button
            type="button"
            className="qe-linkish"
            onClick={() => setNoteOpen(false)}
          >
            {t("publicPool.quickEntry.collapseNote")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="qe-linkish"
          onClick={() => setNoteOpen(true)}
        >
          {t("publicPool.quickEntry.addNote")}
        </button>
      )}
    </form>
  );
}

function BatchEntryForm({
  rows,
  rowErrors,
  formError,
  submitting,
  updateRow,
  handleRemoveRow,
  banner,
  bannerTone,
  processingRetryAfter,
  handleSubmit,
  handleNewBatch,
  t,
}: {
  rows: QuickEntryFormRow[];
  rowErrors: Record<string, string>;
  formError: string | null;
  submitting: boolean;
  updateRow: (id: string, patch: Partial<QuickEntryFormRow>) => void;
  handleRemoveRow: (id: string) => void;
  banner: string | null;
  bannerTone: "error" | "info" | "success" | null;
  processingRetryAfter: number | null;
  handleSubmit: () => void;
  handleNewBatch: () => void;
  t: TFn;
}) {
  return (
    <div className="space-y-4">
      {formError ? (
        <p className="text-sm text-red-600" role="alert">
          {formError}
        </p>
      ) : null}
      <ul className="space-y-4">
        {rows.map((row, index) => (
          <li
            key={row.clientRowId}
            className="rounded-xl border border-[var(--color-crm-border)] p-4"
          >
            <p className="mb-3 text-sm font-medium text-[var(--color-crm-text)]">
              {t("publicPool.quickEntry.rowLabel", { n: String(index + 1) })}
            </p>
            <div className="grid gap-3">
              <div>
                <Label htmlFor={`${row.clientRowId}-name`}>
                  {t("publicPool.quickEntry.fields.customerName")}
                </Label>
                <Input
                  id={`${row.clientRowId}-name`}
                  value={row.customerName}
                  disabled={submitting}
                  aria-invalid={Boolean(rowErrors[row.clientRowId])}
                  onChange={(e) =>
                    updateRow(row.clientRowId, { customerName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`${row.clientRowId}-phone`}>
                  {t("publicPool.quickEntry.fields.phone")}
                </Label>
                <PhoneField
                  id={`${row.clientRowId}-phone`}
                  value={row.phone}
                  disabled={submitting}
                  placeholder={t(
                    "publicPool.quickEntry.fields.phonePlaceholder",
                  )}
                  onChange={(phone) => updateRow(row.clientRowId, { phone })}
                />
              </div>
              <div>
                <Label htmlFor={`${row.clientRowId}-wechat`}>
                  {t("publicPool.quickEntry.fields.wechatId")}
                </Label>
                <Input
                  id={`${row.clientRowId}-wechat`}
                  value={row.wechatId}
                  disabled={submitting}
                  onChange={(e) =>
                    updateRow(row.clientRowId, { wechatId: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`${row.clientRowId}-project`}>
                  {t("publicPool.quickEntry.fields.requestedProjectName")}
                </Label>
                <Input
                  id={`${row.clientRowId}-project`}
                  value={row.requestedProjectName}
                  disabled={submitting}
                  onChange={(e) =>
                    updateRow(row.clientRowId, {
                      requestedProjectName: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`${row.clientRowId}-followup`}>
                  {t("publicPool.quickEntry.fields.initialFollowUpNote")}
                </Label>
                <Textarea
                  id={`${row.clientRowId}-followup`}
                  value={row.initialFollowUpNote}
                  disabled={submitting}
                  onChange={(e) =>
                    updateRow(row.clientRowId, {
                      initialFollowUpNote: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`${row.clientRowId}-note`}>
                  {t("publicPool.quickEntry.fields.supplementalNote")}
                </Label>
                <Textarea
                  id={`${row.clientRowId}-note`}
                  value={row.supplementalNote}
                  disabled={submitting}
                  onChange={(e) =>
                    updateRow(row.clientRowId, {
                      supplementalNote: e.target.value,
                    })
                  }
                />
              </div>
              {rowErrors[row.clientRowId] ? (
                <p className="text-sm text-red-600" role="alert">
                  {rowErrors[row.clientRowId]}
                </p>
              ) : null}
            </div>
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
          </li>
        ))}
      </ul>
      {banner && bannerTone === "error" && processingRetryAfter == null ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {t("publicPool.quickEntry.retry")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={handleNewBatch}
          >
            {t("publicPool.quickEntry.newBatch")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SingleResultView({
  kind,
  result,
  draft,
  onContinue,
  onBackEdit,
  onNewBatch,
  onViewPool,
  onClose,
  t,
  mapError,
}: {
  kind: ReturnType<typeof deriveSingleEntryResultKind>;
  result: QuickEntryRowResultView | null | undefined;
  draft: QuickEntryFormRow | null;
  onContinue: () => void;
  onBackEdit: () => void;
  onNewBatch: () => void;
  onViewPool: () => void;
  onClose: () => void;
  t: TFn;
  mapError: (code: string) => string;
}) {
  if (kind === "success" && result?.status === "created") {
    return (
      <div className="qe-result-card space-y-3">
        <h3 className="text-lg font-semibold text-[var(--color-crm-text)]">
          {t("publicPool.quickEntry.resultSuccessTitle")}
        </h3>
        <p className="text-sm font-medium text-[var(--color-crm-text)]">
          {result.customerCode}
        </p>
        <p className="text-sm text-[var(--color-crm-text-secondary)]">
          {result.customerName}
        </p>
        {draft?.requestedProjectName ? (
          <p className="text-sm text-[var(--color-crm-text-secondary)]">
            {draft.requestedProjectName}
          </p>
        ) : null}
        <p className="text-sm text-[var(--color-crm-text)]">
          {t("publicPool.quickEntry.resultSuccessPool")}
        </p>
        <p className="text-xs text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.resultSource")}
        </p>
        <p className="text-xs text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.reviseNeedsNewBatch")}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button type="button" onClick={onContinue}>
            {t("publicPool.quickEntry.resultContinueNext")}
          </Button>
          <Button type="button" variant="secondary" onClick={onViewPool}>
            {t("publicPool.quickEntry.resultViewPool")}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("publicPool.quickEntry.close")}
          </Button>
        </div>
      </div>
    );
  }

  if (kind === "duplicate" && result?.status === "duplicate") {
    return (
      <div className="qe-result-card space-y-3">
        <h3 className="text-lg font-semibold text-[var(--color-crm-text)]">
          {t("publicPool.quickEntry.resultDuplicateTitle")}
        </h3>
        <p className="text-sm font-medium text-[var(--color-crm-text)]">
          {t("publicPool.quickEntry.resultDuplicateHeading")}
        </p>
        <p className="text-sm text-[var(--color-crm-text-secondary)]" role="status">
          {result.duplicateField === "wechatId"
            ? t("publicPool.quickEntry.duplicateWechat")
            : t("publicPool.quickEntry.duplicatePhone")}
        </p>
        <p className="text-xs text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.reviseNeedsNewBatch")}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button type="button" onClick={onBackEdit}>
            {t("publicPool.quickEntry.resultBackEdit")}
          </Button>
          <Button type="button" variant="secondary" onClick={onNewBatch}>
            {t("publicPool.quickEntry.newBatch")}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("publicPool.quickEntry.close")}
          </Button>
        </div>
      </div>
    );
  }

  if (kind === "invalid" && result?.status === "invalid") {
    return (
      <div className="qe-result-card space-y-3">
        <h3 className="text-lg font-semibold text-[var(--color-crm-text)]">
          {t("publicPool.quickEntry.resultInvalidTitle")}
        </h3>
        <p className="text-sm text-red-600" role="alert">
          {mapError(result.errorCode)}
        </p>
        <p className="text-xs text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.reviseNeedsNewBatch")}
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Button type="button" onClick={onBackEdit}>
            {t("publicPool.quickEntry.resultBackEdit")}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("publicPool.quickEntry.close")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="qe-result-card space-y-3">
      <h3 className="text-lg font-semibold text-[var(--color-crm-text)]">
        {t("publicPool.quickEntry.resultFailedTitle")}
      </h3>
      <p className="text-sm text-red-600" role="alert">
        {result && "errorCode" in result
          ? mapError(result.errorCode)
          : t("publicPool.quickEntry.errors.generic")}
      </p>
      <p className="text-xs text-[var(--color-crm-text-secondary)]">
        {t("publicPool.quickEntry.reviseNeedsNewBatch")}
      </p>
      <div className="flex flex-col gap-2 pt-2">
        <Button type="button" onClick={onBackEdit}>
          {t("publicPool.quickEntry.resultBackEdit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onNewBatch}>
          {t("publicPool.quickEntry.newBatch")}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("publicPool.quickEntry.close")}
        </Button>
      </div>
    </div>
  );
}

function BatchResultsView({
  batchResult,
  rows,
  resultsById,
  onNewBatch,
  onViewPool,
  onClose,
  t,
  mapError,
}: {
  batchResult: QuickEntryBatchSuccessView;
  rows: QuickEntryFormRow[];
  resultsById: Map<string, QuickEntryRowResultView> | null;
  onNewBatch: () => void;
  onViewPool: () => void;
  onClose: () => void;
  t: TFn;
  mapError: (code: string) => string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--color-crm-border)] bg-[var(--color-crm-bg-muted)] p-3 text-sm">
        <p className="font-medium text-[var(--color-crm-text)]">
          {t("publicPool.quickEntry.summaryTitle")}
        </p>
        <p className="mt-1 text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.summaryLine", {
            total: String(batchResult.summary.total),
            created: String(batchResult.summary.created),
            duplicates: String(batchResult.summary.duplicates),
            invalid: String(batchResult.summary.invalid),
            failed: String(batchResult.summary.failed),
          })}
        </p>
        <p className="mt-2 text-xs text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.reviseNeedsNewBatch")}
        </p>
      </div>
      <ul className="space-y-3">
        {rows.map((row, index) => {
          const result = resultsById?.get(row.clientRowId) ?? null;
          return (
            <li
              key={row.clientRowId}
              className="rounded-xl border border-[var(--color-crm-border)] p-4"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-[var(--color-crm-text)]">
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
                    {t(`publicPool.quickEntry.status.${result.status}`)}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-[var(--color-crm-text)]">
                {row.customerName || "—"}
              </p>
              {result?.status === "created" ? (
                <p className="mt-1 text-sm text-[var(--color-crm-text-secondary)]">
                  {t("publicPool.quickEntry.createdDetail", {
                    code: result.customerCode,
                    name: result.customerName,
                  })}
                </p>
              ) : null}
              {result?.status === "duplicate" ? (
                <p className="mt-1 text-sm text-[var(--color-crm-text-secondary)]">
                  {result.duplicateField === "wechatId"
                    ? t("publicPool.quickEntry.duplicateWechat")
                    : t("publicPool.quickEntry.duplicatePhone")}
                </p>
              ) : null}
              {result?.status === "invalid" || result?.status === "failed" ? (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {mapError(result.errorCode)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-2">
        <Button type="button" onClick={onNewBatch}>
          {t("publicPool.quickEntry.newBatch")}
        </Button>
        <Button type="button" variant="secondary" onClick={onViewPool}>
          {t("publicPool.quickEntry.refreshPool")}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("publicPool.quickEntry.close")}
        </Button>
      </div>
    </div>
  );
}
