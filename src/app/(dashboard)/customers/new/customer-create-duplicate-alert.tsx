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
        id: string;
        customerCode?: string | null;
        displayName: string;
        salesStage: string;
        href: string;
      };
};

export function isCustomerCreateDuplicateConflict(
  status: number,
  data: { code?: string; errorCode?: string },
): boolean {
  if (status !== 409) return false;
  return (
    data.code === "duplicate_customer" || data.errorCode === "DUPLICATE_CUSTOMER"
  );
}

function normalizeDuplicateFieldKey(field: string): string {
  const raw = field.trim().toLowerCase();
  if (raw === "phone") return "phone";
  if (raw === "wechatid" || raw === "wechat_id" || raw === "wechat") {
    return "wechatId";
  }
  if (raw === "email") return "email";
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
  duplicates: CustomerCreateDuplicateMatch[] | null;
  onEditContact: () => void;
};

export function CustomerCreateDuplicateAlert({
  alertRef,
  duplicates,
  onEditContact,
}: Props) {
  const { t, salesStage, fieldLabel } = useCustomerLabels();
  const list = duplicates ?? [];
  const isEmpty = list.length === 0;
  const allMasked =
    !isEmpty && list.every((item) => item.customer.isMasked === true);

  return (
    <div
      ref={alertRef}
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      className={cn(
        "mb-6 scroll-mt-28 rounded-xl border border-amber-300/80 bg-amber-50/90 p-4 outline-none",
        "dark:border-amber-500/40 dark:bg-amber-950/40",
        "focus-visible:ring-2 focus-visible:ring-amber-400/60",
      )}
    >
      <div className="flex gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
          )}
          aria-hidden
        >
          <CircleAlert className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[#172033] dark:text-slate-100">
            {t("customers.duplicateAlertTitle")}
          </h3>
          <p className="mt-1 text-sm text-[#3A465C] dark:text-slate-300">
            {isEmpty
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
                      className="rounded-lg border border-amber-200/80 bg-white/70 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-slate-900/40"
                    >
                      <span className="font-medium text-[#172033] dark:text-slate-100">
                        {t("customers.fieldExists", { field: fieldName })}
                      </span>
                    </li>
                  );
                }

                const customer = item.customer;
                return (
                  <li
                    key={`full-${customer.id}-${fieldKey}-${index}`}
                    className="rounded-lg border border-amber-200/80 bg-white/70 px-3 py-2.5 dark:border-amber-500/30 dark:bg-slate-900/40"
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
                      className="mt-2 inline-flex min-h-10 items-center text-sm font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-200"
                    >
                      {t("customers.viewExistingClient")}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={onEditContact}
            >
              {t("customers.duplicateEditContact")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
