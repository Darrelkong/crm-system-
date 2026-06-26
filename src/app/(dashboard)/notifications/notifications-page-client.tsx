"use client";

import { PageIntro } from "@/components/ui/page-intro";
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
      <PageIntro
        title={t("notifications.center")}
        description={t("notifications.subtitle")}
      />
      <NotificationsClient userRole={userRole} />
    </div>
  );
}
