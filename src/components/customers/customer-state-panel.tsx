"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n/provider";

export function CustomerStatePanel({
  titleKey,
  descriptionKey,
  backHref,
  backKey = "customers.backToList",
  variant = "default",
}: {
  titleKey: string;
  descriptionKey?: string;
  backHref: string;
  backKey?: string;
  variant?: "default" | "error";
}) {
  const { t } = useTranslation();
  const isError = variant === "error";

  return (
    <div
      className={
        isError
          ? "rounded-lg border border-red-200 bg-red-50 p-8 text-center"
          : "rounded-lg border border-slate-200 bg-white p-8 text-center"
      }
    >
      <p className={isError ? "font-medium text-red-700" : "text-slate-500"}>
        {t(titleKey)}
      </p>
      {descriptionKey && (
        <p className={`mt-1 text-sm ${isError ? "text-red-600" : "text-slate-500"}`}>
          {t(descriptionKey)}
        </p>
      )}
      <Link
        href={backHref}
        className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
      >
        {t(backKey)}
      </Link>
    </div>
  );
}
