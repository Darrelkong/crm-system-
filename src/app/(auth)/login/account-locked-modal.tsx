"use client";

import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "@/i18n/provider";

const COUNTDOWN_SECONDS = 5;

function AccountLockedModalContent({ onClose }: { onClose: () => void }) {
  const { t, locale } = useTranslation();
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const isChineseLocale = locale === "zh-Hant" || locale === "zh-Hans";

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          onClose();
          return 1;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      aria-hidden="true"
    >
      <div
        className="w-full max-w-md rounded-3xl border border-red-100 bg-white p-6 shadow-2xl sm:p-8"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="account-locked-title"
        aria-describedby="account-locked-message account-locked-countdown"
      >
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <CircleAlert
              className="h-7 w-7 text-red-600"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>

          <h2
            id="account-locked-title"
            className="mt-5 text-2xl font-semibold tracking-tight text-[#172033] sm:text-[1.75rem]"
          >
            {t("auth.accountLockedTitle")}
          </h2>

          <p
            id="account-locked-message"
            className={
              isChineseLocale
                ? "mt-4 text-2xl font-semibold leading-relaxed text-[#172033] sm:text-[1.625rem]"
                : "mt-4 text-lg font-medium leading-relaxed text-[#3D4A5C] sm:text-xl"
            }
          >
            {t("auth.accountLocked")}
          </p>

          <p
            id="account-locked-countdown"
            className="mt-10 text-6xl font-bold tabular-nums text-red-600 sm:text-7xl"
            aria-live="polite"
            aria-atomic="true"
          >
            {countdown}
          </p>

          <p className="mt-4 text-sm text-[#6B7890]">
            {t("auth.accountLockedAutoClose")}
          </p>
        </div>
      </div>
    </div>
  );
}

export function AccountLockedModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return <AccountLockedModalContent onClose={onClose} />;
}
