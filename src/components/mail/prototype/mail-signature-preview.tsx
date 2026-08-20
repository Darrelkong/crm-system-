"use client";

import { Lock } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import {
  MOCK_SIGNATURE_HTML,
  MOCK_STAFF_SIGNATURE_HTML,
} from "@/lib/mail/prototype/mock-data";

export function MailSignaturePreview({ isStaff }: { isStaff: boolean }) {
  const { t } = useTranslation();
  const html = isStaff ? MOCK_STAFF_SIGNATURE_HTML : MOCK_SIGNATURE_HTML;

  return (
    <div className="mt-4 border-t crm-border pt-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs crm-text-secondary">
        <Lock className="h-3.5 w-3.5" />
        <span>{t("mail.signature.locked")}</span>
      </div>
      <div
        className="mail-signature-preview rounded-xl bg-black/[0.02] px-4 py-3 text-sm crm-text dark:bg-white/[0.03]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="mt-2 flex h-10 w-24 items-center justify-center rounded-lg border border-dashed crm-border text-[10px] crm-text-secondary">
        {t("mail.signature.mockLogo")}
      </div>
    </div>
  );
}
