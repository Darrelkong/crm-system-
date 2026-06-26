"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";

export function DashboardHeaderActions() {
  const { t } = useTranslation();

  return (
    <Link href="/customers/new">
      <Button size="lg" className="gap-2">
        <Plus className="h-4 w-4" aria-hidden />
        {t("nav.addCustomerButton")}
      </Button>
    </Link>
  );
}
