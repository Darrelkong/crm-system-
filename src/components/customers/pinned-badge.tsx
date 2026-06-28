"use client";

import { useTranslation } from "@/i18n/provider";
import { cn } from "@/lib/cn";

export function PinnedBadge({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200",
        className,
      )}
    >
      {t("customers.pinnedBadge")}
    </span>
  );
}
