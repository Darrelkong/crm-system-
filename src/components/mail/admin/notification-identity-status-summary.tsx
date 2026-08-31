"use client";

import { Badge, Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import {
  resolveNotificationIdentityDisplayStatus,
  resolveNotificationIdentityStateModel,
  type NotificationIdentityApiItem,
} from "@/lib/mail/client/notification-identity-management";
import { formatHongKongDateTime } from "@/lib/timezone";

function statusBadgeVariant(
  status: ReturnType<typeof resolveNotificationIdentityDisplayStatus>,
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

function IdentityEmailBlock({
  title,
  item,
}: {
  title: string;
  item: NotificationIdentityApiItem;
}) {
  const { t } = useTranslation();
  const status = resolveNotificationIdentityDisplayStatus(item);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide crm-text-secondary">
        {title}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusBadgeVariant(status)}>
          {t(`mail.adminCenter.notificationIdentity.status.${status}`)}
        </Badge>
      </div>
      <p className="break-all text-sm font-medium crm-text">{item.email}</p>
      {status === "verified" && item.verifiedAt ? (
        <p className="text-xs crm-text-secondary">
          {t("mail.adminCenter.notificationIdentity.verifiedAt")}:{" "}
          {formatHongKongDateTime(item.verifiedAt)}
        </p>
      ) : null}
      {status === "pending" && item.verificationExpiresAt ? (
        <p className="text-xs crm-text-secondary">
          {t("mail.adminCenter.notificationIdentity.expiresAt")}:{" "}
          {formatHongKongDateTime(item.verificationExpiresAt)}
        </p>
      ) : null}
    </div>
  );
}

export function NotificationIdentityStatusSummary({
  items,
  accountEmail,
  memberName,
  showMemberHeader = false,
}: {
  items: NotificationIdentityApiItem[];
  accountEmail?: string;
  memberName?: string;
  showMemberHeader?: boolean;
}) {
  const { t } = useTranslation();
  const state = resolveNotificationIdentityStateModel(items);

  if (!state.verified && !state.pending) {
    const latestRevoked = items
      .filter(
        (item) =>
          item.revokedAt != null || item.verificationStatus === "revoked",
      )
      .sort((left, right) =>
        (right.revokedAt ?? right.updatedAt).localeCompare(
          left.revokedAt ?? left.updatedAt,
        ),
      )[0];

    if (latestRevoked) {
      return (
        <Card padding className="space-y-2 border p-4 md:p-6">
          <Badge variant="danger">
            {t("mail.notificationMailbox.disabledStateLabel")}
          </Badge>
          <p className="text-sm crm-text-secondary">
            {t("mail.adminCenter.notificationIdentity.revokedStateMessage")}
          </p>
        </Card>
      );
    }

    return (
      <Card padding className="space-y-2 border p-4 md:p-6">
        <Badge variant="default">
          {t("mail.adminCenter.access.notificationLifecycle.none")}
        </Badge>
        <p className="text-sm crm-text-secondary">
          {t("mail.adminCenter.access.targetNotification.empty")}
        </p>
      </Card>
    );
  }

  const replacementPending =
    state.pending &&
    state.verified &&
    state.pending.email.trim().toLowerCase() !==
      state.verified.email.trim().toLowerCase();

  return (
    <Card padding className="space-y-4 border p-4 md:p-6">
      {showMemberHeader ? (
        <div className="space-y-1 border-b crm-border pb-4">
          {memberName ? (
            <p className="text-sm font-medium crm-text">{memberName}</p>
          ) : null}
          {accountEmail ? (
            <p className="break-all text-sm crm-text-secondary">{accountEmail}</p>
          ) : null}
        </div>
      ) : null}

      {state.verified ? (
        <IdentityEmailBlock
          title={
            replacementPending
              ? t("mail.notificationMailbox.currentVerifiedEmail")
              : t("mail.notificationMailbox.notificationEmailLabel")
          }
          item={state.verified}
        />
      ) : null}

      {replacementPending && state.pending ? (
        <IdentityEmailBlock
          title={t("mail.notificationMailbox.pendingReplacementEmail")}
          item={state.pending}
        />
      ) : null}

      {!replacementPending && state.pending && !state.verified ? (
        <IdentityEmailBlock
          title={t("mail.notificationMailbox.notificationEmailLabel")}
          item={state.pending}
        />
      ) : null}
    </Card>
  );
}
