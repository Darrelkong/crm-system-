"use client";

import { CustomerSourceSelector } from "@/components/customers/customer-source-selector";
import { Label } from "@/components/ui/form";
import type { CustomerSourceMenuOption } from "@/lib/customer-sources/keys";
import { cn } from "@/lib/cn";

type TFn = (key: string, params?: Record<string, string>) => string;

export function QuickEntrySourceField({
  rowId,
  value,
  onChange,
  options,
  disabled,
  fieldError,
  t,
  compact,
}: {
  rowId: string;
  value: string;
  onChange: (tagKey: string) => void;
  options: CustomerSourceMenuOption[];
  disabled?: boolean;
  fieldError?: boolean;
  t: TFn;
  compact?: boolean;
}) {
  const fieldId = `${rowId}-source`;

  return (
    <div className={cn(compact ? "space-y-1" : "space-y-1.5")}>
      <Label htmlFor={fieldId}>
        {t("publicPool.quickEntry.fields.customerSource")}
      </Label>
      <CustomerSourceSelector
        id={fieldId}
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled || options.length === 0}
        aria-label={t("publicPool.quickEntry.fields.customerSource")}
      />
      {fieldError ? (
        <p className="qe-field-error" role="alert">
          {t("publicPool.quickEntry.validation.source_required")}
        </p>
      ) : null}
    </div>
  );
}
