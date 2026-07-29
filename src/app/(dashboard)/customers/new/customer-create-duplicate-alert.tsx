"use client";

import type { RefObject } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { cn } from "@/lib/cn";

export type CustomerCreateDuplicateMatch = {
  field: string;
  matchedField?: string;
  customer:
    | { isMasked: true }
    | {
        isMasked: false;
        id?: string;
        customerCode?: string | null;
        displayName: string;
        salesStage: string;
        href: string;
      };
};

export type CustomerCreateDuplicateAlertMode =
  | "contact-hard-duplicate"
  | "name-soft-warning";

export function isCustomerCreateDuplicateConflict(
  status: number,
  data: { code?: string; errorCode?: string },
): boolean {
  if (status !== 409) return false;
  return (
    data.code === "duplicate_customer" || data.errorCode === "DUPLICATE_CUSTOMER"
  );
}

export function isCustomerCreateNameDuplicateWarning(
  status: number,
  data: { code?: string; errorCode?: string },
): boolean {
  if (status !== 409) return false;
  return (
    data.code === "duplicate_customer_name" ||
    data.errorCode === "DUPLICATE_CUSTOMER_NAME"
  );
}

function normalizeDuplicateFieldKey(field: string): string {
  const raw = field.trim().toLowerCase();
  if (raw === "phone") return "phone";
  if (raw === "wechatid" || raw === "wechat_id" || raw === "wechat") {
    return "wechatId";
  }
  if (raw === "email") return "email";
  if (raw === "name" || raw === "customername" || raw === "customer_name") {
    return "name";
  }
  return field;
}

/** First duplicate field used to focus the matching contact input. */
export function resolveDuplicateFocusField(
  duplicates: CustomerCreateDuplicateMatch[] | null | undefined,
): "phone" | "wechatId" | "email" | null {
  if (!duplicates || duplicates.length === 0) return null;
  const raw = normalizeDuplicateFieldKey(
    duplicates[0]?.matchedField ?? duplicates[0]?.field ?? "",
  );
  if (raw === "phone" || raw === "wechatId" || raw === "email") return raw;
  return null;
}

type Props = {
  alertRef: RefObject<HTMLDivElement | null>;
  mode: CustomerCreateDuplicateAlertMode;
  duplicates: CustomerCreateDuplicateMatch[] | null;
  onEditContact: () => void;
  onEditName?: () => void;
  onConfirmContinue?: () => void;
  confirmingContinue?: boolean;
};

export function CustomerCreateDuplicateAlert({
  alertRef,
  mode,
  duplicates,
  onEditContact,
  onEditName,
  onConfirmContinue,
  confirmingContinue = false,
}: Props) {
  const { t, salesStage, fieldLabel } = useCustomerLabels();
  const list = duplicates ?? [];
  const isEmpty = list.length === 0;
  const allMasked =
    !isEmpty && list.every((item) => item.customer.isMasked === true);
  const isNameWarning = mode === "name-soft-warning";

  const shellClass = isNameWarning
    ? cn(
        "border-slate-200 border-l-4 border-l-blue-700 bg-slate-50/70",
        "dark:border-slate-800 dark:border-l-blue-400 dark:bg-slate-950/35",
        "focus-visible:ring-2 focus-visible:ring-blue-700/25 dark:focus-visible:ring-blue-400/30",
      )
    : cn(
        "border-stone-200 border-l-4 border-l-rose-700 bg-stone-50/75",
        "dark:border-zinc-800 dark:border-l-rose-400 dark:bg-zinc-950/35",
        "focus-visible:ring-2 focus-visible:ring-rose-700/25 dark:focus-visible:ring-rose-400/30",
      );

  const iconClass = isNameWarning
    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300"
    : "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300";

  const itemClass = isNameWarning
    ? "border-slate-200/90 bg-white/70 dark:border-slate-700/60 dark:bg-slate-900/40"
    : "border-stone-200/90 bg-white/70 dark:border-zinc-700/60 dark:bg-zinc-900/40";

  const linkClass = isNameWarning
    ? "text-slate-800 hover:text-blue-800 dark:text-slate-200 dark:hover:text-blue-300"
    : "text-stone-800 hover:text-rose-800 dark:text-zinc-200 dark:hover:text-rose-300";

  return (
    <div
      ref={alertRef}
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      className={cn(
        "mb-6 scroll-mt-28 rounded-xl border p-4 outline-none",
        shellClass,
      )}
    >
      <div className="flex gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            iconClass,
          )}
          aria-hidden
        >
          <CircleAlert className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[#172033] dark:text-slate-100">
            {isNameWarning
              ? t("customers.duplicateNameAlertTitle")
              : t("customers.duplicateAlertTitle")}
          </h3>
          <p className="mt-1 text-sm text-[#3A465C] dark:text-slate-300">
            {isNameWarning
              ? allMasked || isEmpty
                ? t("customers.duplicateNameMaskedDescription")
                : t("customers.duplicateNameAlertDescription")
              : isEmpty
                ? t("customers.duplicateGenericEmpty")
                : allMasked
                  ? t("customers.duplicateMaskedDescription")
                  : t("customers.duplicateAlertDescription")}
          </p>

          {!isEmpty ? (
            <ul className="mt-3 space-y-2">
              {list.map((item, index) => {
                const fieldKey = normalizeDuplicateFieldKey(
                  item.matchedField ?? item.field,
                );
                const fieldName = fieldLabel(fieldKey);
                if (item.customer.isMasked) {
                  return (
                    <li
                      key={`masked-${fieldKey}-${index}`}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm",
                        itemClass,
                      )}
                    >
                      <span className="font-medium text-[#172033] dark:text-slate-100">
                        {t("customers.fieldExists", { field: fieldName })}
                      </span>
                    </li>
                  );
                }

                const customer = item.customer;
                const rowKey =
                  customer.href ||
                  customer.id ||
                  `${customer.displayName}-${index}`;
                return (
                  <li
                    key={`full-${rowKey}-${fieldKey}-${index}`}
                    className={cn(
                      "rounded-lg border px-3 py-2.5",
                      itemClass,
                    )}
                  >
                    <p className="text-sm font-medium text-[#172033] dark:text-slate-100">
                      {t("customers.fieldExists", { field: fieldName })}
                    </p>
                    <p className="mt-1 break-words text-sm text-[#3A465C] dark:text-slate-300">
                      {t("customers.duplicateAuthorizedNameStage", {
                        name: customer.displayName,
                        stage: salesStage(customer.salesStage),
                      })}
                    </p>
                    <a
                      href={customer.href}
                      className={cn(
                        "mt-2 inline-flex min-h-10 items-center text-sm font-medium underline-offset-2 hover:underline",
                        linkClass,
                      )}
                    >
                      {t("customers.viewExistingClient")}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {isNameWarning ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={onEditName}
                  disabled={confirmingContinue}
                >
                  {t("customers.duplicateNameEditName")}
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  onClick={onConfirmContinue}
                  disabled={confirmingContinue || !onConfirmContinue}
                >
                  {confirmingContinue
                    ? t("customers.duplicateNameConfirming")
                    : t("customers.duplicateNameConfirmContinue")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={onEditContact}
              >
                {t("customers.duplicateEditContact")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
