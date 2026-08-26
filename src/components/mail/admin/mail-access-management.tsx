"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/ui/page-intro";
import {
  DataTable,
  TableBody,
  TableHead,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/provider";
import {
  fetchAdminUsersForMailAccess,
  fetchMailAccessList,
  fetchNotificationIdentities,
  postMailAccessDisable,
  postMailAccessEnable,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  buildMailAccessUserRows,
  canManageMailAccess,
  resolveMailAccessEnableApiFeedback,
  resolveMailAccessEnablePreCheck,
  resolveMailAccessLifecycleStatus,
  resolveMailAccessListErrorFeedback,
  resolveMailAccessOnboardingAction,
  resolveMailAccessRowActions,
  type MailAccessEnableFeedback,
  type MailAccessOnboardingActionKind,
  type MailAccessUserRow,
  type NotificationIdentityLifecycleStatus,
} from "@/lib/mail/client/mail-access-management";
import {
  canManageNotificationIdentity,
  type NotificationIdentityApiItem,
} from "@/lib/mail/client/notification-identity-management";
import { formatHongKongDateTime } from "@/lib/timezone";
import { TargetUserNotificationIdentityPanel } from "./target-user-notification-identity-panel";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

function MailAccessStatusBadge({ row }: { row: MailAccessUserRow }) {
  const { t } = useTranslation();
  const lifecycle = resolveMailAccessLifecycleStatus(row);
  const variant =
    lifecycle === "enabled"
      ? "success"
      : lifecycle === "disabled"
        ? "danger"
        : "default";

  return (
    <Badge variant={variant}>
      {t(`mail.adminCenter.access.lifecycle.${lifecycle}`)}
    </Badge>
  );
}

function NotificationIdentityStatusBadge({
  status,
}: {
  status: NotificationIdentityLifecycleStatus;
}) {
  const { t } = useTranslation();
  const variant =
    status === "verified" ? "success" : status === "pending" ? "warning" : "default";

  return (
    <Badge variant={variant}>
      {t(`mail.adminCenter.access.notificationLifecycle.${status}`)}
    </Badge>
  );
}

function MailAccessEnableFeedbackPanel({
  feedback,
  onConfigureNotificationIdentity,
}: {
  feedback: MailAccessEnableFeedback;
  onConfigureNotificationIdentity?: () => void;
}) {
  const { t } = useTranslation();

  if (feedback.kind === "success") {
    return (
      <p className="text-sm crm-text-secondary" role="status">
        {t("mail.adminCenter.access.enableSuccess")}
      </p>
    );
  }

  if (feedback.kind === "missingIdentity") {
    return (
      <div
        className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
        role="alert"
      >
        <div className="space-y-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {t("mail.adminCenter.access.notificationIdentityRequired")}
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-200/90">
            {t("mail.adminCenter.access.missingIdentityMessage")}
          </p>
        </div>
        {feedback.showConfigureAction && onConfigureNotificationIdentity ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onConfigureNotificationIdentity}
          >
            {t("mail.adminCenter.access.configureNotificationEmail")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (feedback.kind === "permissionDenied") {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        {t("mail.adminCenter.access.permissionDenied")}
      </p>
    );
  }

  return (
    <p className="text-sm text-red-600 dark:text-red-400" role="alert">
      {t("mail.adminCenter.access.enableGenericError")}
    </p>
  );
}

function onboardingActionLabelKey(
  kind: MailAccessOnboardingActionKind,
): string | null {
  switch (kind) {
    case "configureNotificationEmail":
      return "mail.adminCenter.access.actions.configureNotificationEmail";
    case "completeVerification":
      return "mail.adminCenter.access.actions.completeVerification";
    case "enableMail":
      return "mail.adminCenter.access.enable";
    case "disableMail":
      return "mail.adminCenter.access.disable";
    default:
      return null;
  }
}

function MailAccessRowActions({
  row,
  canManage,
  pending,
  onAction,
}: {
  row: MailAccessUserRow;
  canManage: boolean;
  pending: boolean;
  onAction: (userId: string, kind: MailAccessOnboardingActionKind) => void;
}) {
  const { t } = useTranslation();
  const action = resolveMailAccessOnboardingAction(row, canManage);
  const legacyActions = resolveMailAccessRowActions(row, canManage);
  const labelKey = onboardingActionLabelKey(action.kind);

  if (!labelKey) {
    if (!legacyActions.showEnable && !legacyActions.showDisable) {
      return null;
    }
  }

  if (!labelKey) {
    return null;
  }

  const variant = action.kind === "disableMail" ? "danger" : "secondary";

  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() => onAction(row.userId, action.kind)}
    >
      {t(labelKey)}
    </Button>
  );
}

function MailAccessMobileCard({
  row,
  canManage,
  pending,
  onAction,
}: {
  row: MailAccessUserRow;
  canManage: boolean;
  pending: boolean;
  onAction: (userId: string, kind: MailAccessOnboardingActionKind) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium crm-text">{row.name}</p>
        <p className="truncate text-sm crm-text-secondary">{row.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MailAccessStatusBadge row={row} />
        <NotificationIdentityStatusBadge status={row.notificationIdentityStatus} />
        {row.enabledAt ? (
          <span className="text-xs crm-text-secondary">
            {t("mail.adminCenter.access.enabledAt", {
              date: formatHongKongDateTime(row.enabledAt),
            })}
          </span>
        ) : null}
      </div>
      {row.notificationIdentityEmail ? (
        <p className="break-all text-xs crm-text-secondary">
          {t("mail.adminCenter.access.notificationEmailLabel")}:{" "}
          {row.notificationIdentityEmail}
        </p>
      ) : null}
      <MailAccessRowActions
        row={row}
        canManage={canManage}
        pending={pending}
        onAction={onAction}
      />
    </Card>
  );
}

export function MailAccessManagement() {
  const { t } = useTranslation();
  const { session, capabilities } = useMailSession();
  const canManage = canManageMailAccess(capabilities);
  const canConfigureNotificationIdentity =
    canManageNotificationIdentity(capabilities);
  const selfUserId = session?.user.id ?? null;

  const [rows, setRows] = useState<MailAccessUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enableFeedback, setEnableFeedback] = useState<MailAccessEnableFeedback | null>(
    null,
  );
  const [disableMessage, setDisableMessage] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [notificationPanelUserId, setNotificationPanelUserId] = useState<string | null>(
    null,
  );
  const [feedbackTargetUserId, setFeedbackTargetUserId] = useState<string | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!canManage) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [usersResult, accessResult] = await Promise.all([
        fetchAdminUsersForMailAccess(),
        fetchMailAccessList(),
      ]);

      if (!usersResult.ok) {
        setError(
          resolveMailAccessListErrorFeedback(usersResult) === "permissionDenied"
            ? t("mail.adminCenter.access.permissionDenied")
            : usersResult.error,
        );
        setRows([]);
        return;
      }
      if (!accessResult.ok) {
        setError(
          resolveMailAccessListErrorFeedback(accessResult) === "permissionDenied"
            ? t("mail.adminCenter.access.permissionDenied")
            : accessResult.error,
        );
        setRows([]);
        return;
      }

      const activeUsers = usersResult.items.filter((user) => user.status !== "deleted");
      const identityEntries = await Promise.all(
        activeUsers.map(async (user) => {
          const result = await fetchNotificationIdentities(user.id);
          return [
            user.id,
            result.ok ? result.items : [],
          ] as const;
        }),
      );
      const notificationIdentitiesByUserId = new Map<string, NotificationIdentityApiItem[]>(
        identityEntries,
      );

      setRows(
        buildMailAccessUserRows(
          usersResult.items,
          accessResult.items,
          notificationIdentitiesByUserId,
        ),
      );
    } catch {
      setError(t("common.networkError"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = pendingUserId !== null;
  const notificationPanelRow = useMemo(
    () => rows.find((row) => row.userId === notificationPanelUserId) ?? null,
    [notificationPanelUserId, rows],
  );

  function openNotificationPanel(userId: string) {
    setNotificationPanelUserId(userId);
    setFeedbackTargetUserId(userId);
  }

  async function handleEnable(userId: string) {
    if (!canManage) return;
    const row = rows.find((item) => item.userId === userId);
    if (!row) return;

    setEnableFeedback(null);
    setDisableMessage(null);
    setFeedbackTargetUserId(userId);

    const preCheck = resolveMailAccessEnablePreCheck({
      row,
      selfUserId,
      canConfigureNotificationIdentity,
    });
    if (preCheck) {
      setEnableFeedback(preCheck);
      return;
    }

    setPendingUserId(userId);
    try {
      const result = await postMailAccessEnable(userId);
      if (!result.ok) {
        setEnableFeedback(
          resolveMailAccessEnableApiFeedback({
            status: result.status,
            error: result.error,
            errorCode: result.errorCode,
            targetUserId: userId,
            selfUserId,
            canConfigureNotificationIdentity,
          }),
        );
        return;
      }
      setEnableFeedback({ kind: "success" });
      await load();
    } catch {
      setEnableFeedback({ kind: "genericError" });
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleDisable(userId: string) {
    if (!canManage) return;
    setEnableFeedback(null);
    setDisableMessage(null);
    setPendingUserId(userId);
    try {
      const result = await postMailAccessDisable(userId);
      if (!result.ok) {
        setDisableMessage(
          resolveMailAccessEnableApiFeedback({
            status: result.status,
            error: result.error,
            errorCode: result.errorCode,
            targetUserId: userId,
            selfUserId,
            canConfigureNotificationIdentity,
          }).kind === "permissionDenied"
            ? t("mail.adminCenter.access.permissionDenied")
            : t("mail.adminCenter.access.enableGenericError"),
        );
        return;
      }
      setDisableMessage(t("mail.adminCenter.access.disableSuccess"));
      await load();
    } catch {
      setDisableMessage(t("common.networkError"));
    } finally {
      setPendingUserId(null);
    }
  }

  function handleRowAction(userId: string, kind: MailAccessOnboardingActionKind) {
    if (kind === "configureNotificationEmail" || kind === "completeVerification") {
      openNotificationPanel(userId);
      return;
    }
    if (kind === "enableMail") {
      void handleEnable(userId);
      return;
    }
    if (kind === "disableMail") {
      void handleDisable(userId);
    }
  }

  function handleConfigureNotificationIdentity() {
    if (feedbackTargetUserId) {
      openNotificationPanel(feedbackTargetUserId);
      return;
    }
  }

  const emptyMessage = useMemo(() => {
    if (!canManage) {
      return t("mail.adminCenter.access.noPermission");
    }
    return t("mail.adminCenter.access.empty");
  }, [canManage, t]);

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.access")}
        description={t("mail.adminCenter.descriptions.access")}
        action={
          canManage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading || pending}
              onClick={() => void load()}
            >
              {t("mail.adminCenter.access.refresh")}
            </Button>
          ) : null
        }
      />

      {enableFeedback ? (
        <MailAccessEnableFeedbackPanel
          feedback={enableFeedback}
          onConfigureNotificationIdentity={handleConfigureNotificationIdentity}
        />
      ) : null}

      {disableMessage ? (
        <p className="text-sm crm-text-secondary" role="status">
          {disableMessage}
        </p>
      ) : null}

      {loading ? (
        <MailAdminLoadingState />
      ) : error ? (
        <MailAdminErrorState
          message={error}
          onRetry={canManage ? () => void load() : undefined}
        />
      ) : rows.length === 0 ? (
        <MailAdminEmptyState message={emptyMessage} />
      ) : (
        <>
          <div className={`${MAIL_ADMIN_CARD_STACK_CLASS} md:hidden`}>
            {rows.map((row) => (
              <MailAccessMobileCard
                key={row.userId}
                row={row}
                canManage={canManage}
                pending={pendingUserId === row.userId}
                onAction={handleRowAction}
              />
            ))}
          </div>

          <TableShell className="hidden md:block">
            <DataTable>
              <TableHead>
                <Tr>
                  <Th>{t("mail.adminCenter.access.columns.name")}</Th>
                  <Th>{t("mail.adminCenter.access.columns.email")}</Th>
                  <Th>{t("mail.adminCenter.access.columns.mailStatus")}</Th>
                  <Th>{t("mail.adminCenter.access.columns.notificationStatus")}</Th>
                  <Th>{t("mail.adminCenter.access.columns.enabledAt")}</Th>
                  {canManage ? (
                    <Th className="text-right">
                      {t("mail.adminCenter.access.columns.actions")}
                    </Th>
                  ) : null}
                </Tr>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <Tr key={row.userId}>
                    <Td>{row.name}</Td>
                    <Td>{row.email}</Td>
                    <Td>
                      <MailAccessStatusBadge row={row} />
                    </Td>
                    <Td>
                      <div className="space-y-1">
                        <NotificationIdentityStatusBadge
                          status={row.notificationIdentityStatus}
                        />
                        {row.notificationIdentityEmail ? (
                          <p className="max-w-[14rem] truncate text-xs crm-text-secondary">
                            {row.notificationIdentityEmail}
                          </p>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      {row.enabledAt
                        ? formatHongKongDateTime(row.enabledAt)
                        : t("mail.adminCenter.access.notApplicable")}
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <MailAccessRowActions
                          row={row}
                          canManage={canManage}
                          pending={pendingUserId === row.userId}
                          onAction={handleRowAction}
                        />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </TableBody>
            </DataTable>
          </TableShell>
        </>
      )}

      <TargetUserNotificationIdentityPanel
        open={notificationPanelUserId != null}
        targetUserId={notificationPanelUserId}
        targetUserName={notificationPanelRow?.name ?? ""}
        targetUserEmail={notificationPanelRow?.email ?? ""}
        onClose={() => setNotificationPanelUserId(null)}
        onUpdated={() => void load()}
      />
    </div>
  );
}
