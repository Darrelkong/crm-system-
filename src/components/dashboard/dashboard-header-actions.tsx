"use client";

import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";

const actionButtonClassName = cn(
  "h-[3.25rem] min-h-[3.25rem] gap-2 rounded-[17px] px-4 text-[0.9375rem] font-medium",
  "sm:h-14 sm:min-h-14",
);

const knowledgeAiButtonClassName = cn(
  actionButtonClassName,
  "border border-indigo-200/80 bg-indigo-50/90 text-indigo-700 shadow-none",
  "hover:border-indigo-300 hover:bg-indigo-100/90 hover:text-indigo-800",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300",
);

export function DashboardHeaderActions() {
  const { t } = useTranslation();

  return (
    <div className="inline-flex max-w-full flex-row flex-wrap items-stretch gap-2.5 sm:gap-3">
      <Link href="/customers/new" className="shrink-0">
        <Button
          className={cn(
            actionButtonClassName,
            "min-w-[9.25rem] max-w-[9.875rem] gap-2 whitespace-nowrap",
          )}
        >
          <Plus className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
          {t("nav.addCustomerButton")}
        </Button>
      </Link>
      <Link href="/knowledge" className="shrink-0">
        <Button
          className={cn(
            knowledgeAiButtonClassName,
            "min-w-[9.0625rem] max-w-[9.875rem] whitespace-nowrap",
          )}
        >
          <Sparkles
            className="h-[1.125rem] w-[1.125rem] shrink-0 text-indigo-600"
            aria-hidden
          />
          Knowledge AI
        </Button>
      </Link>
    </div>
  );
}
