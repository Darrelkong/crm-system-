"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useTranslation } from "@/i18n/provider";
import { redirectToAccessLogout } from "@/lib/auth/client-security";

export function AccessExpiredGate() {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      redirectToAccessLogout();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="auth-shell relative">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold text-[#172033]">
          {t("security.sessionTimeoutTitle")}
        </h1>
        <p className="mt-3 text-sm text-[#6B7890]">{t("security.accessExpired")}</p>
        <p className="mt-2 text-sm text-[#6B7890]">{t("security.reloginRequired")}</p>
        <Button
          type="button"
          className="mt-6 w-full"
          onClick={() => redirectToAccessLogout()}
        >
          {t("security.verifyAccessAgain")}
        </Button>
      </Card>
    </div>
  );
}
