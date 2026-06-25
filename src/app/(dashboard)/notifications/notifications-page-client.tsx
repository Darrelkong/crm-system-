"use client";

import { useTranslation } from "@/i18n/provider";
import { NotificationsClient } from "./notifications-client";

export function NotificationsPageClient({
  userRole,
}: {
  userRole: "admin" | "staff";
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">
          {t("notifications.center")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t("notifications.subtitle")}</p>
      </div>
      <NotificationsClient userRole={userRole} />
    </div>
  );
}
