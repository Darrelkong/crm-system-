"use client";

import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { QUICK_ENTRY_FIXED_PHONE_COUNTRY_CODE } from "@/lib/public-pool/quick-entry-customer-validation";
import {
  QUICK_ENTRY_PROJECT_SUGGESTIONS,
  buildQuickEntryCardSummary,
  canRemoveQuickEntryRow,
  deriveQuickEntryCardBadge,
  filterProjectSuggestions,
  type QuickEntryBatchSuccessView,
  type QuickEntryCardBadge,
  type QuickEntryFieldErrors,
  type QuickEntryFormRow,
  type QuickEntryRowResultView,
} from "./quick-entry-ui";

type TFn = (key: string, params?: Record<string, string>) => string;

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

function badgeVariant(
  badge: QuickEntryCardBadge,
): "default" | "success" | "warning" | "danger" | "accent" {
  if (badge === "created" || badge === "ready") return "success";
  if (badge === "duplicate" || badge === "submitting") return "warning";
  if (badge === "error" || badge === "invalid" || badge === "failed") {
    return "danger";
  }
  return "default";
}

function AccordionRowFields({
  row,
  fieldErrors,
  submitting,
  noteOpen,
  setNoteOpen,
  updateRow,
  t,
  otherLabel,
}: {
  row: QuickEntryFormRow;
  fieldErrors?: QuickEntryFieldErrors;
  submitting: boolean;
  noteOpen: boolean;
  setNoteOpen: (open: boolean) => void;
  updateRow: (id: string, patch: Partial<QuickEntryFormRow>) => void;
  t: TFn;
  otherLabel: string;
}) {
  const [comboOpen, setComboOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const phoneInvalid = Boolean(fieldErrors?.phone || fieldErrors?.contact);
  const suggestions = filterProjectSuggestions(row.requestedProjectName);

  function pickProject(value: string) {
    const isOther = value === "其他" || value === otherLabel;
    updateRow(row.clientRowId, {
      requestedProjectName: isOther ? "" : value,
    });
    setComboOpen(false);
  }

  function onProjectKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const list =
      suggestions.length > 0 ? suggestions : [...QUICK_ENTRY_PROJECT_SUGGESTIONS];
    if (!comboOpen && (event.key === "ArrowDown" || event.key === "Enter")) {
      setComboOpen(true);
      return;
    }
    if (!comboOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((highlight + 1) % list.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((highlight - 1 + list.length) % list.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = list[highlight];
      if (picked) pickProject(picked);
    } else if (event.key === "Escape") {
      setComboOpen(false);
    }
  }

  const list =
    suggestions.length > 0 ? suggestions : [...QUICK_ENTRY_PROJECT_SUGGESTIONS];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-1">
        <Label htmlFor={`${row.clientRowId}-name`}>
          {t("publicPool.quickEntry.fields.customerName")}
        </Label>
        <Input
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
      <div className="md:col-span-1">
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
            aria-expanded={comboOpen}
            onFocus={() => setComboOpen(true)}
            onChange={(e) => {
              updateRow(row.clientRowId, {
                requestedProjectName: e.target.value,
              });
              setComboOpen(true);
              setHighlight(0);
            }}
            onKeyDown={onProjectKeyDown}
            onBlur={() => setTimeout(() => setComboOpen(false), 120)}
          />
          {comboOpen ? (
            <ul className="qe-combo-list" role="listbox">
              {list.map((item, index) => (
                <li key={item}>
                  <button
                    type="button"
                    role="option"
                    className="qe-combo-item"
                    aria-selected={index === highlight}
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
        {fieldErrors?.requestedProjectName ? (
          <p className="qe-field-error" role="alert">
            {t(
              `publicPool.quickEntry.validation.${fieldErrors.requestedProjectName}`,
            )}
          </p>
        ) : null}
      </div>
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
      <div className="md:col-span-2">
        <Label htmlFor={`${row.clientRowId}-followup`}>
          {t("publicPool.quickEntry.fields.initialFollowUpNote")}
        </Label>
        <Textarea
          id={`${row.clientRowId}-followup`}
          className="min-h-[88px]"
          value={row.initialFollowUpNote}
          disabled={submitting}
          onChange={(e) =>
            updateRow(row.clientRowId, {
              initialFollowUpNote: e.target.value,
            })
          }
        />
      </div>
      <div className="md:col-span-2">
        {noteOpen ? (
          <>
            <Label htmlFor={`${row.clientRowId}-note`}>
              {t("publicPool.quickEntry.fields.supplementalNote")}
            </Label>
            <Textarea
              id={`${row.clientRowId}-note`}
              className="min-h-[80px]"
              value={row.supplementalNote}
              disabled={submitting}
              onChange={(e) =>
                updateRow(row.clientRowId, {
                  supplementalNote: e.target.value,
                })
              }
            />
            <button
              type="button"
              className="qe-linkish"
              onClick={() => setNoteOpen(false)}
            >
              {t("publicPool.quickEntry.collapseNote")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="qe-linkish"
            onClick={() => setNoteOpen(true)}
          >
            {t("publicPool.quickEntry.addNote")}
          </button>
        )}
      </div>
    </div>
  );
}

export function BatchAccordionForm({
  rows,
  openCardIds,
  setOpenCardIds,
  fieldErrorsByRow,
  rowErrors,
  formError,
  submitting,
  updateRow,
  onRequestDelete,
  onExpandAll,
  onCollapseAll,
  onAddRow,
  noteOpenByRow,
  setNoteOpenForRow,
  banner,
  bannerTone,
  processingRetryAfter,
  onRetry,
  onNewBatch,
  t,
}: {
  rows: QuickEntryFormRow[];
  openCardIds: string[];
  setOpenCardIds: (ids: string[]) => void;
  fieldErrorsByRow: Record<string, QuickEntryFieldErrors>;
  rowErrors: Record<string, string>;
  formError: string | null;
  submitting: boolean;
  updateRow: (id: string, patch: Partial<QuickEntryFormRow>) => void;
  onRequestDelete: (clientRowId: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onAddRow: () => void;
  noteOpenByRow: Record<string, boolean>;
  setNoteOpenForRow: (id: string, open: boolean) => void;
  banner: string | null;
  bannerTone: "error" | "info" | "success" | null;
  processingRetryAfter: number | null;
  onRetry: () => void;
  onNewBatch: () => void;
  t: TFn;
}) {
  const otherLabel = t("publicPool.quickEntry.projectOtherOption");
  const openSet = new Set(openCardIds);

  function toggleCard(id: string) {
    if (submitting) return;
    if (openSet.has(id)) {
      setOpenCardIds(openCardIds.filter((x) => x !== id));
    } else {
      setOpenCardIds([...openCardIds, id]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="qe-batch-toolbar">
        <p className="qe-batch-toolbar-count">
          {t("publicPool.quickEntry.batchAddedCount", {
            count: String(rows.length),
          })}
        </p>
        <div className="qe-batch-toolbar-actions">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={submitting}
            onClick={onExpandAll}
          >
            {t("publicPool.quickEntry.batchExpandAll")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={submitting}
            onClick={onCollapseAll}
          >
            {t("publicPool.quickEntry.batchCollapseAll")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={submitting}
            onClick={onAddRow}
          >
            {t("publicPool.quickEntry.batchAddCustomer")}
          </Button>
        </div>
      </div>

      {formError ? (
        <p className="text-sm text-red-600" role="alert">
          {formError}
        </p>
      ) : null}

      <ul className="qe-acc-list">
        {rows.map((row, index) => {
          const isOpen = openSet.has(row.clientRowId);
          const fieldErrors = fieldErrorsByRow[row.clientRowId];
          const hasErrors = Boolean(
            fieldErrors && Object.keys(fieldErrors).length > 0,
          );
          const badge = deriveQuickEntryCardBadge(row, {
            submitting,
            hasFieldErrors: hasErrors,
          });
          const summary = buildQuickEntryCardSummary(row);
          const panelId = `${row.clientRowId}-panel`;
          return (
            <li
              key={row.clientRowId}
              className={cn(
                "qe-acc-card",
                isOpen && "is-open",
                hasErrors && "is-error",
              )}
            >
              <div className="qe-acc-summary">
                <div className="qe-acc-summary-meta">
                  <p className="qe-acc-summary-title">
                    {t("publicPool.quickEntry.batchCardLabel", {
                      n: String(index + 1),
                    })}
                    {" · "}
                    {summary.nameEmpty
                      ? t("publicPool.quickEntry.batchEmptyName")
                      : summary.nameText}
                  </p>
                  <p className="qe-acc-summary-sub">
                    {summary.contactKind === "empty"
                      ? t("publicPool.quickEntry.batchEmptyContact")
                      : summary.contactText}
                    {" · "}
                    {summary.projectEmpty
                      ? t("publicPool.quickEntry.batchEmptyProject")
                      : summary.projectText}
                  </p>
                </div>
                <Badge variant={badgeVariant(badge)}>
                  {t(`publicPool.quickEntry.cardBadge.${badge}`)}
                </Badge>
                <div className="qe-acc-summary-actions">
                  <button
                    type="button"
                    className="qe-acc-icon-btn"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    disabled={submitting}
                    onClick={() => toggleCard(row.clientRowId)}
                  >
                    {isOpen
                      ? t("publicPool.quickEntry.batchCollapse")
                      : t("publicPool.quickEntry.batchExpand")}
                  </button>
                  <button
                    type="button"
                    className="qe-acc-icon-btn"
                    aria-label={t("publicPool.quickEntry.batchDeleteAria", {
                      n: String(index + 1),
                    })}
                    disabled={submitting}
                    onClick={() => onRequestDelete(row.clientRowId)}
                  >
                    {canRemoveQuickEntryRow(rows.length)
                      ? t("publicPool.quickEntry.removeRow")
                      : t("publicPool.quickEntry.clearRow")}
                  </button>
                </div>
              </div>
              <div className="qe-acc-body" id={panelId} hidden={!isOpen}>
                {isOpen ? (
                  <>
                    {rowErrors[row.clientRowId] ? (
                      <p className="qe-field-error mb-3" role="alert">
                        {rowErrors[row.clientRowId]}
                      </p>
                    ) : null}
                    <AccordionRowFields
                      row={row}
                      fieldErrors={fieldErrors}
                      submitting={submitting}
                      noteOpen={Boolean(noteOpenByRow[row.clientRowId])}
                      setNoteOpen={(open) =>
                        setNoteOpenForRow(row.clientRowId, open)
                      }
                      updateRow={updateRow}
                      t={t}
                      otherLabel={otherLabel}
                    />
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {banner && bannerTone === "error" && processingRetryAfter == null ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={onRetry}
          >
            {t("publicPool.quickEntry.retry")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={onNewBatch}
          >
            {t("publicPool.quickEntry.newBatch")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function BatchResultsPanel({
  batchResult,
  rows,
  resultsById,
  detailOpenIds,
  setDetailOpenIds,
  onReturnIncomplete,
  onNewBatch,
  onViewPool,
  onClose,
  showActions = true,
  t,
  mapError,
}: {
  batchResult: QuickEntryBatchSuccessView;
  rows: QuickEntryFormRow[];
  resultsById: Map<string, QuickEntryRowResultView> | null;
  detailOpenIds: string[];
  setDetailOpenIds: (ids: string[]) => void;
  onReturnIncomplete: () => void;
  onNewBatch: () => void;
  onViewPool: () => void;
  onClose: () => void;
  showActions?: boolean;
  t: TFn;
  mapError: (code: string) => string;
}) {
  const hasIncomplete =
    batchResult.summary.duplicates +
      batchResult.summary.invalid +
      batchResult.summary.failed >
    0;
  const detailSet = new Set(detailOpenIds);

  function toggleDetail(id: string) {
    if (detailSet.has(id)) {
      setDetailOpenIds(detailOpenIds.filter((x) => x !== id));
    } else {
      setDetailOpenIds([...detailOpenIds, id]);
    }
  }

  return (
    <div className="space-y-4">
      <div className="qe-result-card space-y-3">
        <h3 className="text-lg font-semibold text-[var(--color-crm-text)]">
          {t("publicPool.quickEntry.summaryTitle")}
        </h3>
        <div className="qe-result-summary-grid">
          {(
            [
              ["summaryTotal", batchResult.summary.total],
              ["summaryCreated", batchResult.summary.created],
              ["summaryDuplicates", batchResult.summary.duplicates],
              ["summaryInvalid", batchResult.summary.invalid],
              ["summaryFailed", batchResult.summary.failed],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="qe-result-summary-cell">
              <div className="n">{value}</div>
              <div className="l">{t(`publicPool.quickEntry.${key}`)}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--color-crm-text-secondary)]">
          {t("publicPool.quickEntry.reviseNeedsNewBatch")}
        </p>
      </div>

      <ul className="space-y-2">
        {rows.map((row, index) => {
          const result = resultsById?.get(row.clientRowId) ?? null;
          const open = detailSet.has(row.clientRowId);
          const badge = deriveQuickEntryCardBadge(row, { result });
          return (
            <li
              key={row.clientRowId}
              className="rounded-xl border border-[var(--color-crm-border)] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--color-crm-text)]">
                    {t("publicPool.quickEntry.batchCardLabel", {
                      n: String(index + 1),
                    })}
                    {" · "}
                    {row.customerName.trim() ||
                      t("publicPool.quickEntry.batchEmptyName")}
                  </p>
                  {result?.status === "created" ? (
                    <p className="mt-1 text-sm text-[var(--color-crm-text-secondary)]">
                      {result.customerCode}
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
                </div>
                <Badge variant={badgeVariant(badge)}>
                  {t(`publicPool.quickEntry.cardBadge.${badge}`)}
                </Badge>
              </div>
              <button
                type="button"
                className="qe-linkish"
                aria-expanded={open}
                onClick={() => toggleDetail(row.clientRowId)}
              >
                {open
                  ? t("publicPool.quickEntry.resultHideDetails")
                  : t("publicPool.quickEntry.resultViewDetails")}
              </button>
              {open ? (
                <div className="qe-result-detail">
                  {result?.status === "created" ? (
                    <>
                      <p>{result.customerCode}</p>
                      <p>{result.customerName}</p>
                      <p>{t("publicPool.quickEntry.resultAddedToPool")}</p>
                      <p>{t("publicPool.quickEntry.resultSource")}</p>
                    </>
                  ) : null}
                  {result?.status === "duplicate" ? (
                    <p>
                      {result.duplicateField === "wechatId"
                        ? t("publicPool.quickEntry.duplicateWechat")
                        : t("publicPool.quickEntry.duplicatePhone")}
                    </p>
                  ) : null}
                  {result?.status === "invalid" || result?.status === "failed" ? (
                    <p role="alert">{mapError(result.errorCode)}</p>
                  ) : null}
                  {!result ? (
                    <p>{t("publicPool.quickEntry.errors.generic")}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {showActions ? (
        <div className="flex flex-col gap-2">
          {hasIncomplete ? (
            <Button type="button" onClick={onReturnIncomplete}>
              {t("publicPool.quickEntry.returnIncomplete")}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onViewPool}>
            {t("publicPool.quickEntry.resultViewPool")}
          </Button>
          <Button type="button" onClick={onNewBatch}>
            {t("publicPool.quickEntry.newBatch")}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("publicPool.quickEntry.close")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function batchResultsHasIncomplete(
  batchResult: QuickEntryBatchSuccessView,
): boolean {
  return (
    batchResult.summary.duplicates +
      batchResult.summary.invalid +
      batchResult.summary.failed >
    0
  );
}
