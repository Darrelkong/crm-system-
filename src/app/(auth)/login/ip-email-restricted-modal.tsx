"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/i18n/provider";
import { LoginModalShell } from "@/app/(auth)/login/login-modal-shell";
import { getRemainingRestrictionSeconds } from "@/lib/auth/ip-email-restriction";

export function IpEmailRestrictedModal({
  open,
  restrictedUntil,
  onExpired,
}: {
  open: boolean;
  restrictedUntil: string;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    const initial = getRemainingRestrictionSeconds(restrictedUntil);
    if (initial <= 0) {
      onExpired();
      return;
    }

    const timer = window.setInterval(() => {
      const next = getRemainingRestrictionSeconds(restrictedUntil);
      if (next <= 0) {
        window.clearInterval(timer);
        onExpired();
        return;
      }
      setTick((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [open, onExpired, restrictedUntil]);

  const remainingSeconds = useMemo(
    () => getRemainingRestrictionSeconds(restrictedUntil),
    [restrictedUntil, tick],
  );

  if (!open) {
    return null;
  }

  return (
    <LoginModalShell
      title={t("auth.ipEmailRestrictedTitle")}
      message={t("auth.ipEmailRestrictedMessage")}
      countdown={Math.max(remainingSeconds, 0)}
      countdownSuffix={t("auth.ipEmailRestrictedCountdownSuffix")}
      ariaLabelledBy="ip-email-restricted-title"
      ariaDescribedBy="ip-email-restricted-message ip-email-restricted-countdown"
    />
  );
}
