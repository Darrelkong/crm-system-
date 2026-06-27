"use client";

import { useTranslation } from "@/i18n/provider";
import { LoginModalShell } from "@/app/(auth)/login/login-modal-shell";

export function LoginPendingModal({ open }: { open: boolean }) {
  const { t } = useTranslation();

  if (!open) {
    return null;
  }

  return (
    <LoginModalShell
      icon="loading"
      title={t("auth.loginPendingTitle")}
      message={t("auth.loginPendingMessage")}
      ariaLabelledBy="login-pending-title"
      ariaDescribedBy="login-pending-message"
    />
  );
}
