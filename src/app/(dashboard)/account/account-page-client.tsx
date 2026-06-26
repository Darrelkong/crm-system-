"use client";

import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { AccountChangePasswordForm } from "./account-change-password-form";

export function AccountPageClient({
  displayName,
  email,
  role,
}: {
  displayName: string;
  email: string;
  role: "admin" | "staff";
}) {
  const { t } = useTranslation();
  const roleLabel = role === "admin" ? t("nav.roleAdmin") : t("nav.roleStaff");

  return (
    <div className="space-y-6">
      <PageIntro
        title={t("nav.accountCenter")}
        description={t("placeholders.accountDescription")}
      />
      <div className="surface-card p-6">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-[#6B7890]">{t("account.displayName")}</dt>
            <dd className="mt-1 font-medium text-[#172033]">{displayName}</dd>
          </div>
          <div>
            <dt className="text-[#6B7890]">{t("account.email")}</dt>
            <dd className="mt-1 font-medium text-[#172033]">{email}</dd>
          </div>
          <div>
            <dt className="text-[#6B7890]">{t("account.role")}</dt>
            <dd className="mt-1 font-medium uppercase text-[#172033]">{roleLabel}</dd>
          </div>
        </dl>
      </div>
      <AccountChangePasswordForm />
    </div>
  );
}
