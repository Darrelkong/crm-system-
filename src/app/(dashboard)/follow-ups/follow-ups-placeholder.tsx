"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";

export function FollowUpsPlaceholder() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("nav.followUps")}
        description={t("placeholders.followUpsDescription")}
      />
      <EmptyState
        message={t("placeholders.followUpsEmpty")}
        action={
          <Link href="/customers" className="link-primary text-sm">
            {t("nav.customers")}
          </Link>
        }
      />
    </div>
  );
}
