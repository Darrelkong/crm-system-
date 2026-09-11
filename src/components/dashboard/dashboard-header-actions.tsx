"use client";

import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";

const knowledgeAiButtonClassName = cn(
  "gap-2 border border-indigo-500/20 bg-gradient-to-br from-indigo-600 to-violet-700 text-white shadow-sm",
  "hover:-translate-y-px hover:from-indigo-500 hover:to-violet-600 hover:shadow-md",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400",
);

export function DashboardHeaderActions() {
  const { t } = useTranslation();

  return (
    <div className="inline-flex max-w-full flex-row items-stretch justify-end gap-2">
      <Link href="/customers/new" className="shrink-0">
        <Button size="md" className="gap-1.5 px-3.5 whitespace-nowrap">
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          {t("nav.addCustomerButton")}
        </Button>
      </Link>
      <Link href="/knowledge" className="shrink-0">
        <Button
          size="md"
          className={cn("gap-1.5 px-3.5 whitespace-nowrap", knowledgeAiButtonClassName)}
        >
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/15"
            aria-hidden
          >
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          Knowledge AI
        </Button>
      </Link>
    </div>
  );
}
