"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import { fetchNotificationIdentities } from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  filterSelfNotificationIdentities,
  resolveOverviewNotificationIdentitySummary,
  type NotificationIdentityDisplayStatus,
  type OverviewNotificationIdentitySummary,
} from "@/lib/mail/client/notification-identity-management";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminDefinitionRow,
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
} from "./mail-admin-states";

function statusBadgeVariant(
  status: NotificationIdentityDisplayStatus,
): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "verified":
      return "success";
    case "pending":
      return "warning";
    case "bounced":
    case "revoked":
      return "danger";
    default:
      return "default";
  }
}

function NotificationIdentityCardSkeleton() {
  return <MailAdminLoadingState compact />;
}

function NotificationIdentitySummaryBody({
  summary,
}: {
  summary: OverviewNotificationIdentitySummary;
}) {
  const { t } = useTranslation();

  if (summary.kind === "none") {
    return (
      <div className="space-y-2">
        <MailAdminEmptyState
          compact
          message={t("mail.adminCenter.overview.notificationIdentityNone")}
        />
        <p className="text-sm crm-text-secondary">
          {t("mail.adminCenter.overview.notificationIdentityConfigureHint")}
        </p>
      </div>
    );
  }

  return (
    <dl className="space-y-3">
      <MailAdminDefinitionRow
        label={t("mail.adminCenter.overview.notificationIdentityEmail")}
        mono
      >
        {summary.email}
      </MailAdminDefinitionRow>
      <MailAdminDefinitionRow
        label={t("mail.adminCenter.overview.notificationIdentityStatusLabel")}
      >
        <Badge variant={statusBadgeVariant(summary.displayStatus)}>
          {t(
            `mail.adminCenter.notificationIdentity.status.${summary.displayStatus}`,
          )}
        </Badge>
      </MailAdminDefinitionRow>
      {summary.verifiedAt ? (
        <MailAdminDefinitionRow
          label={t("mail.adminCenter.overview.notificationIdentityVerifiedAt")}
        >
          {formatHongKongDateTime(summary.verifiedAt)}
        </MailAdminDefinitionRow>
      ) : null}
    </dl>
  );
}

export function MailAdminOverviewNotificationIdentityCard() {
  const { t } = useTranslation();
  const { session } = useMailSession();
  const selfUserId = session?.user.id ?? null;

  const [summary, setSummary] = useState<OverviewNotificationIdentitySummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selfUserId) {
      setSummary(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetchNotificationIdentities(selfUserId);
      if (!result.ok) {
        setSummary(null);
        setError(result.error);
        return;
      }
      const selfItems = filterSelfNotificationIdentities(result.items, selfUserId);
      setSummary(resolveOverviewNotificationIdentitySummary(selfItems));
    } catch {
      setSummary(null);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [selfUserId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card padding className="p-4 md:p-6">
      <h3 className="text-sm font-semibold crm-text">
        {t("mail.adminCenter.overview.notificationIdentityTitle")}
      </h3>
      <p className="mt-1 text-sm crm-text-secondary">
        {t("mail.adminCenter.overview.notificationIdentityHint")}
      </p>
      <div className="mt-4">
        {loading ? (
          <NotificationIdentityCardSkeleton />
        ) : error ? (
          <MailAdminErrorState message={error} onRetry={() => void load()} />
        ) : summary ? (
          <NotificationIdentitySummaryBody summary={summary} />
        ) : null}
      </div>
    </Card>
  );
}
