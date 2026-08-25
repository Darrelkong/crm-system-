"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";

type MailNoAccessStateProps = {
  dashboardHref?: "/admin" | "/staff";
};

export function MailNoAccessState({
  dashboardHref = "/admin",
}: MailNoAccessStateProps) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h2 className="text-lg font-semibold crm-text">
        {t("mail.noAccess.title")}
      </h2>
      <p className="mt-2 max-w-sm text-sm crm-text-secondary">
        {t("mail.noAccess.description")}
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-6"
        onClick={() => router.push(dashboardHref)}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("mail.noAccess.backToDashboard")}
      </Button>
    </div>
  );
}
