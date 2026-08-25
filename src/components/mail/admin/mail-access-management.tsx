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
  postMailAccessDisable,
  postMailAccessEnable,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  buildMailAccessUserRows,
  canManageMailAccess,
  resolveMailAccessEnableApiFeedback,
  resolveMailAccessEnablePreCheck,
  resolveMailAccessListErrorFeedback,
  resolveMailAccessRowActions,
  type MailAccessEnableFeedback,
  type MailAccessUserRow,
} from "@/lib/mail/client/mail-access-management";
import { useMailAdminCenterNavigation } from "@/lib/mail/client/mail-admin-center-navigation";
import { canManageNotificationIdentity } from "@/lib/mail/client/notification-identity-management";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

function MailAccessStatusBadge({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  return (
    <Badge variant={enabled ? "success" : "default"}>
      {enabled
        ? t("mail.adminCenter.access.statusEnabled")
        : t("mail.adminCenter.access.statusDisabled")}
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
            {t("mail.adminCenter.access.configureNotificationIdentity")}
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

function MailAccessRowActions({
  row,
  canManage,
  pending,
  onEnable,
  onDisable,
}: {
  row: MailAccessUserRow;
  canManage: boolean;
  pending: boolean;
  onEnable: (userId: string) => void;
  onDisable: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const actions = resolveMailAccessRowActions(row, canManage);

  if (!actions.showEnable && !actions.showDisable) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.showEnable ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => onEnable(row.userId)}
        >
          {t("mail.adminCenter.access.enable")}
        </Button>
      ) : null}
      {actions.showDisable ? (
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => onDisable(row.userId)}
        >
          {t("mail.adminCenter.access.disable")}
        </Button>
      ) : null}
    </div>
  );
}

function MailAccessMobileCard({
  row,
  canManage,
  pending,
  onEnable,
  onDisable,
}: {
  row: MailAccessUserRow;
  canManage: boolean;
  pending: boolean;
  onEnable: (userId: string) => void;
  onDisable: (userId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium crm-text">{row.name}</p>
        <p className="truncate text-sm crm-text-secondary">{row.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MailAccessStatusBadge enabled={row.isEnabled} />
        {row.enabledAt ? (
          <span className="text-xs crm-text-secondary">
            {t("mail.adminCenter.access.enabledAt", {
              date: formatHongKongDateTime(row.enabledAt),
            })}
          </span>
        ) : null}
      </div>
      <MailAccessRowActions
        row={row}
        canManage={canManage}
        pending={pending}
        onEnable={onEnable}
        onDisable={onDisable}
      />
    </Card>
  );
}

export function MailAccessManagement() {
  const { t } = useTranslation();
  const { session, capabilities } = useMailSession();
  const { navigateToSection } = useMailAdminCenterNavigation();
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

      setRows(buildMailAccessUserRows(usersResult.items, accessResult.items));
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

  async function handleEnable(userId: string) {
    if (!canManage) return;
    const row = rows.find((item) => item.userId === userId);
    if (!row) return;

    setEnableFeedback(null);
    setDisableMessage(null);

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

  function handleConfigureNotificationIdentity() {
    navigateToSection("notificationIdentity");
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
                onEnable={handleEnable}
                onDisable={handleDisable}
              />
            ))}
          </div>

          <TableShell className="hidden md:block">
            <DataTable>
              <TableHead>
                <Tr>
                  <Th>{t("mail.adminCenter.access.columns.name")}</Th>
                  <Th>{t("mail.adminCenter.access.columns.email")}</Th>
                  <Th>{t("mail.adminCenter.access.columns.status")}</Th>
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
                      <MailAccessStatusBadge enabled={row.isEnabled} />
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
                          onEnable={handleEnable}
                          onDisable={handleDisable}
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
    </div>
  );
}
