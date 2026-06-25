"use client";

import { useTranslation } from "@/i18n/provider";
import { ApprovalsClient } from "./approvals-client";

export function ApprovalsPageClient({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">{t("approvals.title")}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {t(isAdmin ? "approvals.subtitleAdmin" : "approvals.subtitleStaff")}
        </p>
      </div>
      <ApprovalsClient isAdmin={isAdmin} />
    </div>
  );
}
