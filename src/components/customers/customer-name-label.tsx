import type { ReactNode } from "react";
import { Badge } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  resolveCustomerNameLabelModel,
  type CustomerNameLabelModelInput,
} from "@/lib/customers/customer-name-label";

/** Matches customer-detail pending badge — subdued, not error styling. */
export const CUSTOMER_NAME_PENDING_BADGE_CLASS =
  "bg-transparent text-[#6B7890] ring-1 ring-[#D5DCEA]";

export type CustomerNameLabelProps = CustomerNameLabelModelInput & {
  /** Already-translated `customers.namePendingBadge` label from caller. */
  pendingLabel: string;
  className?: string;
  nameClassName?: string;
  badgeClassName?: string;
  /** Wrap the display name (e.g. Link). Badge stays a sibling. */
  renderName?: (displayName: string) => ReactNode;
};

/**
 * Presentational name + optional pending badge.
 * Caller passes locale and translated pendingLabel — no i18n hooks here.
 */
export function CustomerNameLabel({
  customerName,
  nameStatus,
  locale,
  pendingLabel,
  showPendingBadge = true,
  className,
  nameClassName,
  badgeClassName,
  renderName,
}: CustomerNameLabelProps) {
  const model = resolveCustomerNameLabelModel({
    customerName,
    nameStatus,
    locale,
    showPendingBadge,
  });

  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {renderName ? (
        renderName(model.displayName)
      ) : (
        <span className={nameClassName}>{model.displayName}</span>
      )}
      {model.showPendingBadge ? (
        <Badge
          className={cn(CUSTOMER_NAME_PENDING_BADGE_CLASS, badgeClassName)}
        >
          {pendingLabel}
        </Badge>
      ) : null}
    </span>
  );
}
