"use client";

import { useEffect, useId, useState } from "react";
import { CustomerProfileFields } from "@/components/customers/customer-profile-fields";
import {
  CUSTOMER_PROFILE_FIELD_KEYS,
  customerHasAnyProfileValue,
  type CustomerProfileFormFields,
} from "@/lib/customers/customer-profile";
import { cn } from "@/lib/cn";

type TFn = (key: string, params?: Record<string, string>) => string;

export function CustomerProfileSection({
  values,
  fieldErrors,
  onChange,
  t,
  idPrefix = "profile",
  className,
  /** When true on mount (edit with data / restored draft), start expanded. */
  initiallyExpanded = false,
}: {
  values: CustomerProfileFormFields;
  fieldErrors: Record<string, string>;
  onChange: (field: keyof CustomerProfileFormFields, value: string) => void;
  t: TFn;
  idPrefix?: string;
  className?: string;
  initiallyExpanded?: boolean;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(initiallyExpanded);

  const hasProfileError = CUSTOMER_PROFILE_FIELD_KEYS.some(
    (key) => Boolean(fieldErrors[key]),
  );

  useEffect(() => {
    if (hasProfileError) {
      setOpen(true);
    }
  }, [hasProfileError]);

  useEffect(() => {
    if (initiallyExpanded) {
      setOpen(true);
    }
  }, [initiallyExpanded]);

  return (
    <div className={cn("surface-card mt-4 p-6", className)}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-[#172033]">
            {t("customers.moreCustomerData")}
          </span>
          <span className="mt-1 block text-sm font-normal text-[#6B7890]">
            {t("customers.moreCustomerDataSubtitle")}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-sm text-[#6B7890]" aria-hidden>
          {open ? "−" : "+"}
        </span>
        <span className="sr-only">
          {open
            ? t("customers.moreCustomerDataCollapse")
            : t("customers.moreCustomerDataExpand")}
        </span>
      </button>

      {open ? (
        <div id={panelId} className="mt-4">
          <CustomerProfileFields
            values={values}
            fieldErrors={fieldErrors}
            onChange={onChange}
            t={t}
            idPrefix={idPrefix}
          />
        </div>
      ) : (
        <div id={panelId} hidden />
      )}
    </div>
  );
}

export function shouldExpandCustomerProfileSection(
  values: CustomerProfileFormFields,
): boolean {
  return customerHasAnyProfileValue(values);
}
