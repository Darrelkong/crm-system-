"use client";

import type { ReactNode } from "react";
import { CircleAlert, Loader2 } from "lucide-react";

type LoginModalShellProps = {
  title: string;
  message: ReactNode;
  icon?: "alert" | "loading";
  countdown?: number | null;
  countdownSuffix?: string;
  footer?: ReactNode;
  ariaLabelledBy: string;
  ariaDescribedBy: string;
};

export function LoginModalShell({
  title,
  message,
  icon = "alert",
  countdown,
  countdownSuffix,
  footer,
  ariaLabelledBy,
  ariaDescribedBy,
}: LoginModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      aria-hidden="false"
    >
      <div
        className="w-full max-w-md rounded-3xl border border-red-100 bg-white p-6 shadow-2xl sm:p-8"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
      >
        <div className="text-center">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
              icon === "loading" ? "bg-[#EEF3F8]" : "bg-red-50"
            }`}
          >
            {icon === "loading" ? (
              <Loader2
                className="h-7 w-7 animate-spin text-[#4f96c0]"
                strokeWidth={2}
                aria-hidden="true"
              />
            ) : (
              <CircleAlert
                className="h-7 w-7 text-red-600"
                strokeWidth={2}
                aria-hidden="true"
              />
            )}
          </div>

          <h2
            id={ariaLabelledBy}
            className="mt-5 text-2xl font-semibold tracking-tight text-[#172033] sm:text-[1.75rem]"
          >
            {title}
          </h2>

          <p
            id={ariaDescribedBy}
            className="mt-4 text-lg font-medium leading-relaxed text-[#3D4A5C] sm:text-xl"
          >
            {message}
          </p>

          {countdown != null && (
            <p
              id="ip-email-restricted-countdown"
              className="mt-10 text-6xl font-bold tabular-nums text-red-600 sm:text-7xl"
              aria-live="polite"
              aria-atomic="true"
            >
              {countdown}
            </p>
          )}

          {countdownSuffix && (
            <p className="mt-4 text-sm text-[#6B7890]">{countdownSuffix}</p>
          )}

          {footer}
        </div>
      </div>
    </div>
  );
}
