"use client";

import { useTranslation } from "@/i18n/provider";

export function MailProductionNoMailboxesState() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h2 className="text-lg font-semibold crm-text">
        {t("mail.mailboxes.noAccessible.title")}
      </h2>
      <p className="mt-2 max-w-sm text-sm crm-text-secondary">
        {t("mail.mailboxes.noAccessible.description")}
      </p>
    </div>
  );
}
