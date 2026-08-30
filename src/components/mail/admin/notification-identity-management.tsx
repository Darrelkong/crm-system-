"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { canManageNotificationIdentity } from "@/lib/mail/client/notification-identity-management";
import { NotificationIdentityTeamOverview } from "./notification-identity-team-overview";
import {
  MailAdminEmptyState,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

export function NotificationIdentityManagement() {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const canManage = canManageNotificationIdentity(capabilities);
  const [reloadKey, setReloadKey] = useState(0);

  const emptyMessage = canManage
    ? t("mail.adminCenter.notificationIdentity.empty")
    : t("mail.adminCenter.notificationIdentity.noPermission");

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.notificationIdentity")}
        description={t("mail.adminCenter.descriptions.notificationIdentityTeam")}
        action={
          canManage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              {t("mail.adminCenter.notificationIdentity.refresh")}
            </Button>
          ) : null
        }
      />

      {!canManage ? (
        <MailAdminEmptyState message={emptyMessage} />
      ) : (
        <NotificationIdentityTeamOverview key={reloadKey} canManage={canManage} />
      )}
    </div>
  );
}
