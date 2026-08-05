"use client";

import { PENDING_NAME_PLACEHOLDERS } from "@/lib/customers/name-status";
import { isRequestedProjectOtherCode } from "@/lib/constants/requested-projects";
import { RequestedProjectSelector } from "@/components/customers/requested-project-selector";
import { Input, Label } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { Locale } from "@/i18n/config";
import type {
  QuickEntryFieldErrors,
  QuickEntryFormRow,
} from "@/app/(dashboard)/public-pool/quick-entry-ui";

type Translate = (key: string) => string;

export type QuickEntryNameProjectFieldsProps = {
  row: QuickEntryFormRow;
  locale: Locale;
  t: Translate;
  fieldErrors?: QuickEntryFieldErrors;
  disabled?: boolean;
  updateRow: (clientRowId: string, patch: Partial<QuickEntryFormRow>) => void;
  compact?: boolean;
};

/**
 * Shared name + requested-project controls for Quick Entry single/batch rows.
 * Mirrors create-customer pending-name and RequestedProjectSelector behavior.
 */
export function QuickEntryNameProjectFields({
  row,
  locale,
  t,
  fieldErrors,
  disabled,
  updateRow,
  compact,
}: QuickEntryNameProjectFieldsProps) {
  const nameId = `${row.clientRowId}-name`;
  const projectId = `${row.clientRowId}-project`;
  const otherId = `${row.clientRowId}-project-other`;

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          {row.nameStatus === "pending" ? (
            <span className="text-sm font-medium crm-text">
              {t("publicPool.quickEntry.fields.customerName")}{" "}
              <span className="text-red-500">*</span>
            </span>
          ) : (
            <Label htmlFor={nameId} className="mb-0">
              {t("publicPool.quickEntry.fields.customerName")}{" "}
              <span className="text-red-500">*</span>
            </Label>
          )}
          <label className="inline-flex max-w-full items-center gap-2 text-sm crm-text-secondary">
            <input
              type="checkbox"
              className="size-4 shrink-0 rounded border-[var(--color-crm-border)] text-[var(--color-crm-primary)] accent-[var(--color-crm-primary)]"
              checked={row.nameStatus === "pending"}
              disabled={disabled}
              onChange={(e) => {
                updateRow(row.clientRowId, {
                  nameStatus: e.target.checked ? "pending" : "confirmed",
                  customerName: "",
                });
              }}
            />
            <span className="leading-snug">{t("customers.nameUnknownToggle")}</span>
          </label>
        </div>
        {row.nameStatus === "pending" ? (
          <div
            role="radiogroup"
            aria-label={t("publicPool.quickEntry.fields.customerName")}
            aria-invalid={Boolean(fieldErrors?.customerName) || undefined}
            className={cn(
              "grid grid-cols-2 gap-2",
              fieldErrors?.customerName &&
                "rounded-[var(--radius-crm)] ring-1 ring-red-500/70",
            )}
          >
            {PENDING_NAME_PLACEHOLDERS.map((placeholder) => {
              const label =
                locale === "en"
                  ? placeholder === "X先生"
                    ? t("customers.pendingNameMrEnLabel")
                    : t("customers.pendingNameMsEnLabel")
                  : placeholder === "X先生"
                    ? t("customers.pendingNameMr")
                    : t("customers.pendingNameMs");
              const selected = row.customerName === placeholder;
              return (
                <button
                  key={placeholder}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  className={cn(
                    "rounded-[var(--radius-crm)] border px-3 py-2 text-sm",
                    selected
                      ? "border-[var(--color-crm-primary)] bg-[var(--color-crm-primary)]/10 text-[var(--color-crm-primary)]"
                      : "border-[var(--color-crm-border)] crm-text",
                  )}
                  onClick={() =>
                    updateRow(row.clientRowId, { customerName: placeholder })
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <Input
            id={nameId}
            value={row.customerName}
            disabled={disabled}
            aria-invalid={Boolean(fieldErrors?.customerName)}
            aria-describedby={
              fieldErrors?.customerName ? `${nameId}-err` : undefined
            }
            onChange={(e) =>
              updateRow(row.clientRowId, { customerName: e.target.value })
            }
          />
        )}
        {fieldErrors?.customerName ? (
          <p id={`${nameId}-err`} className="mt-1 text-xs text-red-600">
            {t(`publicPool.quickEntry.validation.${fieldErrors.customerName}`)}
          </p>
        ) : null}
      </div>

      <div>
        <Label htmlFor={projectId} className="mb-1.5">
          {t("publicPool.quickEntry.fields.requestedProjectName")}{" "}
          <span className="text-red-500">*</span>
        </Label>
        <RequestedProjectSelector
          id={projectId}
          locale={locale}
          valueCode={row.requestedProjectCode}
          valueName={row.requestedProjectName}
          disabled={disabled}
          placeholder={t("customers.requestedProjectNamePlaceholder")}
          selectServiceTitle={t("customers.requestedProjectSelectService")}
          selectCountryTitle={t("customers.requestedProjectSelectCountry")}
          searchPlaceholder={t("customers.requestedProjectSearchPlaceholder")}
          backLabel={t("common.back")}
          closeLabel={t("common.close")}
          onSelect={({ code }) => {
            updateRow(row.clientRowId, {
              requestedProjectCode: code,
              requestedProjectName: isRequestedProjectOtherCode(code)
                ? row.requestedProjectCode &&
                  isRequestedProjectOtherCode(row.requestedProjectCode)
                  ? row.requestedProjectName
                  : ""
                : "",
            });
          }}
          className={
            fieldErrors?.requestedProjectCode || fieldErrors?.requestedProjectName
              ? "ring-1 ring-red-500/70"
              : undefined
          }
        />
        {row.requestedProjectCode &&
        isRequestedProjectOtherCode(row.requestedProjectCode) ? (
          <Input
            id={otherId}
            className="mt-2"
            value={row.requestedProjectName}
            disabled={disabled}
            placeholder={t("customers.requestedProjectOtherNamePlaceholder")}
            aria-invalid={Boolean(fieldErrors?.requestedProjectName)}
            onChange={(e) =>
              updateRow(row.clientRowId, {
                requestedProjectName: e.target.value,
              })
            }
          />
        ) : null}
        {fieldErrors?.requestedProjectCode || fieldErrors?.requestedProjectName ? (
          <p className="mt-1 text-xs text-red-600">
            {t(
              `publicPool.quickEntry.validation.${
                fieldErrors.requestedProjectCode ??
                fieldErrors.requestedProjectName
              }`,
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}
