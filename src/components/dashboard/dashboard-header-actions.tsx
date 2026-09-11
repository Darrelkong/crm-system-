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
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
      <Link href="/customers/new" className="min-w-0">
        <Button size="lg" className="h-full w-full gap-2 sm:w-auto">
          <Plus className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{t("nav.addCustomerButton")}</span>
        </Button>
      </Link>
      <Link href="/knowledge" className="min-w-0">
        <Button size="lg" className={cn("h-full w-full sm:w-auto", knowledgeAiButtonClassName)}>
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15"
            aria-hidden
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="truncate">Knowledge AI</span>
        </Button>
      </Link>
    </div>
  );
}
