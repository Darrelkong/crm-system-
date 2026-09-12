"use client";

import { useTranslation } from "@/i18n/provider";

export function LoginCopyrightFooter() {
  const { t } = useTranslation();

  return (
    <p className="login-page__copyright" data-login-copyright-footer="true">
      {t("auth.copyrightNotice")}
    </p>
  );
}
