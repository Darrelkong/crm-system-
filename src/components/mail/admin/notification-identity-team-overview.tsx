"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import {
  TableBody,
  TableHead,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/provider";
import {
  fetchAdminUsersForMailAccess,
  fetchMailAccessList,
  fetchNotificationIdentities,
} from "@/lib/mail/client/api";
import {
  buildNotificationIdentityTeamOverviewRows,
  filterNotificationIdentityTeamOverviewRows,
  resolveNotificationIdentityTeamOverviewPrimaryAction,
  type NotificationIdentityApiItem,
  type NotificationIdentityTeamOverviewRow,
  type NotificationIdentityTeamOverviewStatusFilter,
} from "@/lib/mail/client/notification-identity-management";
import { formatHongKongDateTime } from "@/lib/timezone";
import { NotificationIdentityOtpModal } from "./notification-identity-otp-modal";
import { NotificationIdentitySettingsModal } from "./notification-identity-settings-modal";
import { TargetUserNotificationIdentityPanel } from "./target-user-notification-identity-panel";
import {
  MAIL_ADMIN_CARD_STACK_CLASS,
  MailAdminLoadingState,
} from "./mail-admin-states";

type SettingsMode = "configure" | "change";

function OverviewStatusBadge({
  row,
}: {
  row: NotificationIdentityTeamOverviewRow;
}) {
  const { t } = useTranslation();
  const status = row.hasPending ? "pending" : row.filterStatus;
  const variant =
    status === "verified"
      ? "success"
      : status === "pending"
        ? "warning"
        : "default";

  return (
    <Badge variant={variant}>
      {t(`mail.adminCenter.access.notificationLifecycle.${status}`)}
    </Badge>
  );
}

function OverviewMemberCell({ row }: { row: NotificationIdentityTeamOverviewRow }) {
  const { t } = useTranslation();

  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium crm-text">{row.name}</p>
      <p className="truncate text-xs crm-text-secondary">{row.email}</p>
      <p className="text-xs crm-text-secondary">
        {row.mailAccessEnabled
          ? t("mail.adminCenter.notificationIdentity.teamOverview.mailEnabled")
          : t("mail.adminCenter.notificationIdentity.teamOverview.mailDisabled")}
      </p>
    </div>
  );
}

function OverviewEmailCell({ row }: { row: NotificationIdentityTeamOverviewRow }) {
  const { t } = useTranslation();

  if (row.filterStatus === "none") {
    return (
      <span className="text-sm crm-text-secondary">
        {t("mail.adminCenter.access.targetNotification.empty")}
      </span>
    );
  }

  if (row.replacementPending && row.verifiedEmail && row.pendingEmail) {
    return (
      <div className="space-y-1 text-sm">
        <p className="break-words crm-text">
          <span className="text-xs crm-text-secondary">
            {t("mail.adminCenter.notificationIdentity.teamOverview.currentEmailPrefix")}
          </span>
          {row.verifiedEmail}
        </p>
        <p className="break-words crm-text-secondary">
          {t("mail.adminCenter.notificationIdentity.teamOverview.pendingEmail", {
            email: row.pendingEmail,
          })}
        </p>
      </div>
    );
  }

  const email = row.verifiedEmail ?? row.pendingEmail;
  if (!email) {
    return null;
  }

  if (row.hasPending && !row.hasVerified) {
    return (
      <div className="space-y-1">
        <p className="break-words text-sm crm-text">{email}</p>
        <Badge variant="warning">
          {t("mail.adminCenter.access.notificationLifecycle.pending")}
        </Badge>
      </div>
    );
  }

  return <p className="break-words text-sm crm-text">{email}</p>;
}

function formatCompactVerifiedAt(value: string): { date: string; time: string } {
  const formatted = formatHongKongDateTime(value);
  const [date, time] = formatted.split(" ");
  return { date: date ?? formatted, time: time ?? "" };
}

function OverviewPrimaryAction({
  row,
  onManage,
  onConfigure,
  onCompleteVerification,
}: {
  row: NotificationIdentityTeamOverviewRow;
  onManage: (row: NotificationIdentityTeamOverviewRow) => void;
  onConfigure: (row: NotificationIdentityTeamOverviewRow) => void;
  onCompleteVerification: (row: NotificationIdentityTeamOverviewRow) => void;
}) {
  const { t } = useTranslation();
  const action = resolveNotificationIdentityTeamOverviewPrimaryAction(row);

  if (action === "configure") {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => onConfigure(row)}>
        {t("mail.adminCenter.notificationIdentity.teamOverview.configureAction")}
      </Button>
    );
  }

  if (action === "completeVerification") {
    return (
      <Button type="button" size="sm" onClick={() => onCompleteVerification(row)}>
        {t("mail.notificationMailbox.completeVerificationAction")}
      </Button>
    );
  }

  return (
    <Button type="button" size="sm" variant="secondary" onClick={() => onManage(row)}>
      {t("mail.adminCenter.notificationIdentity.teamOverview.manageAction")}
    </Button>
  );
}

function OverviewMobileCard({
  row,
  onManage,
  onConfigure,
  onCompleteVerification,
}: {
  row: NotificationIdentityTeamOverviewRow;
  onManage: (row: NotificationIdentityTeamOverviewRow) => void;
  onConfigure: (row: NotificationIdentityTeamOverviewRow) => void;
  onCompleteVerification: (row: NotificationIdentityTeamOverviewRow) => void;
}) {
  const { t } = useTranslation();
  const verifiedAt = row.verifiedAt ? formatCompactVerifiedAt(row.verifiedAt) : null;

  return (
    <Card padding className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <OverviewMemberCell row={row} />
        <OverviewStatusBadge row={row} />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium crm-text-secondary">
          {t("mail.adminCenter.notificationIdentity.teamOverview.columns.email")}
        </p>
        <OverviewEmailCell row={row} />
      </div>

      {verifiedAt ? (
        <p className="text-xs crm-text-secondary">
          {t("mail.adminCenter.notificationIdentity.teamOverview.columns.verifiedAt")}:{" "}
          {verifiedAt.date} {verifiedAt.time}
        </p>
      ) : null}

      <OverviewPrimaryAction
        row={row}
        onManage={onManage}
        onConfigure={onConfigure}
        onCompleteVerification={onCompleteVerification}
      />
    </Card>
  );
}

export function NotificationIdentityTeamOverview({
  canManage,
}: {
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<NotificationIdentityTeamOverviewRow[]>([]);
  const [identityItemsByUserId, setIdentityItemsByUserId] = useState<
    Map<string, NotificationIdentityApiItem[]>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<NotificationIdentityTeamOverviewStatusFilter>("all");
  const [manageRow, setManageRow] = useState<NotificationIdentityTeamOverviewRow | null>(
    null,
  );
  const [settingsTarget, setSettingsTarget] = useState<{
    row: NotificationIdentityTeamOverviewRow;
    mode: SettingsMode;
  } | null>(null);
  const [otpTarget, setOtpTarget] = useState<NotificationIdentityTeamOverviewRow | null>(
    null,
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<NotificationIdentityTeamOverviewRow[]> => {
    if (!canManage) {
      setRows([]);
      setIdentityItemsByUserId(new Map());
      setLoading(false);
      setError(null);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const [usersResult, accessResult] = await Promise.all([
        fetchAdminUsersForMailAccess(),
        fetchMailAccessList(),
      ]);

      if (!usersResult.ok) {
        setError(usersResult.error);
        setRows([]);
        return [];
      }
      if (!accessResult.ok) {
        setError(accessResult.error);
        setRows([]);
        return [];
      }

      const activeUsers = usersResult.items.filter((user) => user.status === "active");
      const identityEntries = await Promise.all(
        activeUsers.map(async (user) => {
          const result = await fetchNotificationIdentities(user.id);
          return [user.id, result.ok ? result.items : []] as const;
        }),
      );
      const notificationIdentitiesByUserId = new Map<string, NotificationIdentityApiItem[]>(
        identityEntries,
      );

      const nextRows = buildNotificationIdentityTeamOverviewRows(
        usersResult.items,
        accessResult.items,
        notificationIdentitiesByUserId,
      );
      setIdentityItemsByUserId(notificationIdentitiesByUserId);
      setRows(nextRows);
      return nextRows;
    } catch {
      setError(t("common.networkError"));
      setRows([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(
    () => filterNotificationIdentityTeamOverviewRows(rows, searchQuery, statusFilter),
    [rows, searchQuery, statusFilter],
  );

  const otpPending = useMemo(() => {
    if (!otpTarget) return null;
    const items = identityItemsByUserId.get(otpTarget.userId) ?? [];
    return items.find((item) => item.id === otpTarget.pendingIdentityId) ?? null;
  }, [identityItemsByUserId, otpTarget]);

  function handleReload() {
    void load();
  }

  if (loading) {
    return <MailAdminLoadingState />;
  }

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="notification-identity-team-overview space-y-4">
      {actionMessage ? (
        <p className="text-sm crm-text-secondary" role="status">
          {actionMessage}
        </p>
      ) : null}

      <div className="notification-identity-team-overview-filters">
        <div className="min-w-0">
          <Label htmlFor="notification-team-search" className="sr-only">
            {t("mail.adminCenter.notificationIdentity.teamOverview.searchLabel")}
          </Label>
          <Input
            id="notification-team-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t(
              "mail.adminCenter.notificationIdentity.teamOverview.searchPlaceholder",
            )}
            className="w-full min-w-0"
          />
        </div>
        <div className="notification-identity-team-overview-filter-status">
          <Label htmlFor="notification-team-status-filter">
            {t("mail.adminCenter.notificationIdentity.teamOverview.statusFilterLabel")}
          </Label>
          <select
            id="notification-team-status-filter"
            className="surface-input mt-1 w-full min-w-0"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as NotificationIdentityTeamOverviewStatusFilter,
              )
            }
          >
            <option value="all">
              {t("mail.adminCenter.notificationIdentity.teamOverview.statusAll")}
            </option>
            <option value="verified">
              {t("mail.adminCenter.access.notificationLifecycle.verified")}
            </option>
            <option value="pending">
              {t("mail.adminCenter.access.notificationLifecycle.pending")}
            </option>
            <option value="none">
              {t("mail.adminCenter.access.notificationLifecycle.none")}
            </option>
          </select>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="text-sm crm-text-secondary">
          {t("mail.adminCenter.notificationIdentity.teamOverview.noMatches")}
        </p>
      ) : (
        <>
          <div className={`${MAIL_ADMIN_CARD_STACK_CLASS} min-w-0 md:hidden`}>
            {filteredRows.map((row) => (
              <OverviewMobileCard
                key={row.userId}
                row={row}
                onManage={setManageRow}
                onConfigure={(target) =>
                  setSettingsTarget({ row: target, mode: "configure" })
                }
                onCompleteVerification={setOtpTarget}
              />
            ))}
          </div>

          <div className="notification-identity-team-overview-table-shell surface-card hidden md:block">
            <table className="notification-identity-team-overview-table text-sm">
              <TableHead>
                <Tr>
                  <Th>
                    {t("mail.adminCenter.notificationIdentity.teamOverview.columns.member")}
                  </Th>
                  <Th>
                    {t("mail.adminCenter.notificationIdentity.teamOverview.columns.email")}
                  </Th>
                  <Th>
                    {t("mail.adminCenter.notificationIdentity.teamOverview.columns.status")}
                  </Th>
                  <Th>
                    {t("mail.adminCenter.notificationIdentity.teamOverview.columns.verifiedAt")}
                  </Th>
                  <Th>
                    {t("mail.adminCenter.notificationIdentity.teamOverview.columns.actions")}
                  </Th>
                </Tr>
              </TableHead>
              <TableBody>
                {filteredRows.map((row) => {
                  const verifiedAt = row.verifiedAt
                    ? formatCompactVerifiedAt(row.verifiedAt)
                    : null;
                  return (
                    <Tr key={row.userId}>
                      <Td>
                        <OverviewMemberCell row={row} />
                      </Td>
                      <Td>
                        <OverviewEmailCell row={row} />
                      </Td>
                      <Td>
                        <OverviewStatusBadge row={row} />
                      </Td>
                      <Td>
                        {verifiedAt ? (
                          <div className="text-sm leading-tight crm-text">
                            <div>{verifiedAt.date}</div>
                            <div className="text-xs crm-text-secondary">
                              {verifiedAt.time}
                            </div>
                          </div>
                        ) : (
                          t("mail.adminCenter.proofDiagnostics.notApplicable")
                        )}
                      </Td>
                      <Td>
                        <OverviewPrimaryAction
                          row={row}
                          onManage={setManageRow}
                          onConfigure={(target) =>
                            setSettingsTarget({ row: target, mode: "configure" })
                          }
                          onCompleteVerification={setOtpTarget}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </TableBody>
            </table>
          </div>
        </>
      )}

      <TargetUserNotificationIdentityPanel
        open={manageRow != null}
        targetUserId={manageRow?.userId ?? null}
        targetUserName={manageRow?.name ?? ""}
        targetUserEmail={manageRow?.email ?? ""}
        onClose={() => setManageRow(null)}
        onUpdated={handleReload}
      />

      {settingsTarget ? (
        <NotificationIdentitySettingsModal
          open
          targetUserId={settingsTarget.row.userId}
          targetUserName={settingsTarget.row.name}
          targetUserEmail={settingsTarget.row.email}
          mode={settingsTarget.mode}
          onClose={() => setSettingsTarget(null)}
          onSaved={() => {
            const savedTarget = settingsTarget;
            setSettingsTarget(null);
            setActionMessage(t("mail.adminCenter.notificationIdentity.createSuccess"));
            void (async () => {
              const freshRows = await load();
              if (savedTarget?.mode === "configure") {
                const freshRow = freshRows.find(
                  (row) => row.userId === savedTarget.row.userId,
                );
                if (freshRow?.pendingIdentityId) {
                  setOtpTarget(freshRow);
                }
              }
            })();
          }}
        />
      ) : null}

      <NotificationIdentityOtpModal
        open={otpTarget != null && otpPending != null}
        targetUserId={otpTarget?.userId ?? ""}
        pending={otpPending}
        onClose={() => setOtpTarget(null)}
        onVerified={() => {
          setActionMessage(t("mail.adminCenter.notificationIdentity.verifySuccess"));
          setOtpTarget(null);
          handleReload();
        }}
        onPendingUpdated={handleReload}
      />
    </div>
  );
}
