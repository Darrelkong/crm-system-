"use client";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import { LoginModalShell } from "@/app/(auth)/login/login-modal-shell";

export function UnauthorizedEmailModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  if (!open) {
    return null;
  }

  return (
    <LoginModalShell
      title={t("auth.unauthorizedEmailTitle")}
      message={t("auth.unauthorizedEmailMessage")}
      ariaLabelledBy="unauthorized-email-title"
      ariaDescribedBy="unauthorized-email-message"
      footer={
        <div className="mt-8">
          <Button type="button" className="login-page__submit w-full" onClick={onClose}>
            {t("auth.retryLogin")}
          </Button>
        </div>
      }
    />
  );
}
