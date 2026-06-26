"use client";

import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { ApprovalsClient } from "./approvals-client";

export function ApprovalsPageClient({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();

  return (
    <div>
      <PageIntro
        title={t("approvals.title")}
        description={t(isAdmin ? "approvals.subtitleAdmin" : "approvals.subtitleStaff")}
      />
      <ApprovalsClient isAdmin={isAdmin} />
    </div>
  );
}
