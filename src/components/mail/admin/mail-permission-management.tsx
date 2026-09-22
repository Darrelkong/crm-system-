"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/ui/page-intro";
import { QuickEntryDrawer } from "@/components/ui/quick-entry-drawer";
import { useTranslation } from "@/i18n/provider";
import {
  fetchAdminGrantsForUser,
  fetchAdminUsersForMailAccess,
  fetchMailAccessList,
  postAdminGrant,
  postAdminGrantRevoke,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  buildMailPermissionGrantRows,
  buildMailPermissionUserRows,
  canManageMailPermissions,
  canManageSuperAdminGrants,
  canRevokeMailAdminGrant,
  listGrantableMailAdminPermissions,
  mailAdminPermissionLabelKey,
  resolveMailPermissionApiFeedback,
  resolveMailPermissionListErrorFeedback,
  type MailAdminGrantApiItem,
  type MailPermissionManagementFeedback,
  type MailPermissionUserRow,
} from "@/lib/mail/client/mail-permission-management";
import type { MailAdminPermission } from "../../../../drizzle/schema/mail-admin-grants";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
  MAIL_ADMIN_TRUNCATE_EMAIL_CLASS,
} from "./mail-admin-states";

function MailAccessLifecycleBadge({
  lifecycle,
}: {
  lifecycle: MailPermissionUserRow["mailAccessLifecycle"];
}) {
  const { t } = useTranslation();
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

function CrmRoleBadge({ role }: { role: MailPermissionUserRow["crmRole"] }) {
  const { t } = useTranslation();
  const label =
    role === "admin"
      ? t("mail.adminCenter.permission.crmRoleAdmin")
      : t("mail.adminCenter.permission.crmRoleStaff");

  return <Badge variant="default">{label}</Badge>;
}

function PermissionFeedbackPanel({
  feedback,
}: {
  feedback: MailPermissionManagementFeedback | null;
}) {
  const { t } = useTranslation();
  if (!feedback) return null;

  if (feedback.kind === "grantSuccess") {
    return (
      <p className="text-sm crm-text-secondary" role="status">
        {t("mail.adminCenter.permission.grantSuccess")}
      </p>
    );
  }
  if (feedback.kind === "revokeSuccess") {
    return (
      <p className="text-sm crm-text-secondary" role="status">
        {t("mail.adminCenter.permission.revokeSuccess")}
      </p>
    );
  }
  if (feedback.kind === "permissionDenied") {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        {t("mail.adminCenter.permission.permissionDenied")}
      </p>
    );
  }
  if (feedback.kind === "conflict") {
    return (
      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
        {t("mail.adminCenter.permission.conflictError")}
      </p>
    );
  }
  return (
    <p className="text-sm text-red-600 dark:text-red-400" role="alert">
      {t("mail.adminCenter.permission.genericError")}
    </p>
  );
}

function UserGrantSummary({
  row,
  grantCount,
}: {
  row: MailPermissionUserRow;
  grantCount: number;
}) {
  const { t } = useTranslation();

  if (row.isRootCrmAdmin) {
    return (
      <Badge variant="success">
        {t("mail.adminCenter.permission.inheritedAuthority")}
      </Badge>
    );
  }
  if (grantCount === 0) {
    return (
      <span className="text-xs crm-text-secondary">
        {t("mail.adminCenter.permission.noGrants")}
      </span>
    );
  }
  return (
    <span className="text-xs crm-text-secondary">
      {t("mail.adminCenter.permission.grantCount", { count: String(grantCount) })}
    </span>
  );
}

function PermissionUserMobileCard({
  row,
  grantCount,
  onOpen,
}: {
  row: MailPermissionUserRow;
  grantCount: number;
  onOpen: (row: MailPermissionUserRow) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card padding className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium crm-text">{row.name}</p>
          <p className={MAIL_ADMIN_TRUNCATE_EMAIL_CLASS}>{row.email}</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => onOpen(row)}>
          {t("mail.adminCenter.permission.manageAction")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CrmRoleBadge role={row.crmRole} />
        <MailAccessLifecycleBadge lifecycle={row.mailAccessLifecycle} />
        <UserGrantSummary row={row} grantCount={grantCount} />
      </div>
    </Card>
  );
}

function PermissionGrantList({
  grants,
  targetIsRootCrmAdmin,
  canManageSuperAdmin,
  pendingGrantId,
  onRevoke,
}: {
  grants: ReturnType<typeof buildMailPermissionGrantRows>;
  targetIsRootCrmAdmin: boolean;
  canManageSuperAdmin: boolean;
  pendingGrantId: string | null;
  onRevoke: (grantId: string, permission: MailAdminPermission) => void;
}) {
  const { t } = useTranslation();

  if (targetIsRootCrmAdmin) {
    return (
      <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
          {t("mail.adminCenter.permission.inheritedAuthorityTitle")}
        </p>
        <p className="text-sm text-emerald-800 dark:text-emerald-200/90">
          {t("mail.adminCenter.permission.inheritedAuthorityDescription")}
        </p>
        {grants.length > 0 ? (
          <p className="text-xs text-emerald-800 dark:text-emerald-200/90">
            {t("mail.adminCenter.permission.inheritedExplicitGrantsNote", {
              count: String(grants.length),
            })}
          </p>
        ) : null}
      </div>
    );
  }

  if (grants.length === 0) {
    return (
      <MailAdminEmptyState
        compact
        message={t("mail.adminCenter.permission.detailNoGrants")}
      />
    );
  }

  return (
    <div className="space-y-3">
      {grants.map((grant) => {
        const canRevoke = canRevokeMailAdminGrant({
          permission: grant.permission,
          targetIsRootCrmAdmin,
          canManageSuperAdmin,
        });
        return (
          <div
            key={grant.grantId}
            className="rounded-lg border crm-border px-3 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium crm-text">
                  {t(mailAdminPermissionLabelKey(grant.permission))}
                </p>
                <p className="text-xs crm-text-secondary">
                  {grant.permission}
                </p>
                <p className="text-xs crm-text-secondary">
                  {t("mail.adminCenter.permission.grantedAt", {
                    date: formatHongKongDateTime(grant.grantedAt),
                  })}
                </p>
              </div>
              {canRevoke ? (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={pendingGrantId === grant.grantId}
                  onClick={() => onRevoke(grant.grantId, grant.permission)}
                >
                  {t("mail.adminCenter.permission.revokeAction")}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MailPermissionManagement() {
  const { t } = useTranslation();
  const { capabilities, isCrmRootAdmin } = useMailSession();
  const canManage = canManageMailPermissions(capabilities);
  const canManageSuperAdmin = canManageSuperAdminGrants({
    isCrmRootAdmin,
    capabilities,
  });

  const [rows, setRows] = useState<MailPermissionUserRow[]>([]);
  const [grantsByUserId, setGrantsByUserId] = useState<
    Map<string, MailAdminGrantApiItem[]>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<MailPermissionUserRow | null>(
    null,
  );
  const [detailGrants, setDetailGrants] = useState<MailAdminGrantApiItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingGrantId, setPendingGrantId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<MailPermissionManagementFeedback | null>(
    null,
  );
  const loadList = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {
      if (!canManage) {
        setRows([]);
        setGrantsByUserId(new Map());
        setLoading(false);
        setError(null);
        return;
      }

      if (!background) {
        setLoading(true);
      }
      setError(null);

      try {
        const [usersResult, accessResult] = await Promise.all([
          fetchAdminUsersForMailAccess(),
          fetchMailAccessList(),
        ]);

        if (!usersResult.ok) {
          if (!background) {
            setError(
              resolveMailPermissionListErrorFeedback(usersResult) ===
                "permissionDenied"
                ? t("mail.adminCenter.permission.permissionDenied")
                : usersResult.error,
            );
            setRows([]);
          }
          return;
        }
        if (!accessResult.ok) {
          if (!background) {
            setError(
              resolveMailPermissionListErrorFeedback(accessResult) ===
                "permissionDenied"
                ? t("mail.adminCenter.permission.permissionDenied")
                : accessResult.error,
            );
            setRows([]);
          }
          return;
        }

        const activeUsers = usersResult.items.filter(
          (user) => user.status !== "deleted",
        );
        const grantEntries = await Promise.all(
          activeUsers.map(async (user) => {
            const result = await fetchAdminGrantsForUser(user.id);
            return [user.id, result.ok ? result.items : []] as const;
          }),
        );
        const nextGrantsByUserId = new Map<string, MailAdminGrantApiItem[]>(
          grantEntries,
        );

        setGrantsByUserId(nextGrantsByUserId);
        setRows(
          buildMailPermissionUserRows(
            usersResult.items,
            accessResult.items,
            nextGrantsByUserId,
          ),
        );
      } catch {
        if (!background) {
          setError(t("common.networkError"));
          setRows([]);
        }
      } finally {
        if (!background) {
          setLoading(false);
        }
      }
    },
    [canManage, t],
  );

  const loadDetail = useCallback(
    async (userId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const result = await fetchAdminGrantsForUser(userId);
        if (!result.ok) {
          setDetailError(
            resolveMailPermissionListErrorFeedback(result) === "permissionDenied"
              ? t("mail.adminCenter.permission.permissionDenied")
              : result.error,
          );
          setDetailGrants([]);
          return;
        }
        setDetailGrants(result.items);
      } catch {
        setDetailError(t("common.networkError"));
        setDetailGrants([]);
      } finally {
        setDetailLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void loadList();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  const openUser = useCallback(
    (row: MailPermissionUserRow) => {
      setSelectedUser(row);
      setFeedback(null);
      void loadDetail(row.userId);
    },
    [loadDetail],
  );

  const closeUser = useCallback(() => {
    setSelectedUser(null);
    setDetailGrants([]);
    setDetailError(null);
    setFeedback(null);
  }, []);

  const selectedGrantRows = useMemo(
    () => buildMailPermissionGrantRows(detailGrants),
    [detailGrants],
  );

  const grantablePermissions = useMemo(() => {
    if (!selectedUser) return [];
    const existing = new Set(
      selectedGrantRows.map((grant) => grant.permission),
    );
    return listGrantableMailAdminPermissions({
      canManageSuperAdmin,
      existingPermissions: existing,
      targetIsRootCrmAdmin: selectedUser.isRootCrmAdmin,
    });
  }, [canManageSuperAdmin, selectedGrantRows, selectedUser]);

  async function handleGrant(permission: MailAdminPermission) {
    if (!selectedUser || !canManage) return;
    setFeedback(null);
    setPendingGrantId(permission);
    try {
      const result = await postAdminGrant(selectedUser.userId, permission);
      if (!result.ok) {
        setFeedback(
          resolveMailPermissionApiFeedback({
            status: result.status,
            errorCode: result.errorCode,
          }),
        );
        return;
      }
      setFeedback({ kind: "grantSuccess" });
      await Promise.all([loadDetail(selectedUser.userId), loadList({ background: true })]);
    } catch {
      setFeedback({ kind: "genericError" });
    } finally {
      setPendingGrantId(null);
    }
  }

  async function handleRevoke(grantId: string, permission: MailAdminPermission) {
    if (!selectedUser || !canManage) return;
    if (
      !canRevokeMailAdminGrant({
        permission,
        targetIsRootCrmAdmin: selectedUser.isRootCrmAdmin,
        canManageSuperAdmin,
      })
    ) {
      return;
    }

    setFeedback(null);
    setPendingGrantId(grantId);
    try {
      const result = await postAdminGrantRevoke(grantId);
      if (!result.ok) {
        setFeedback(
          resolveMailPermissionApiFeedback({
            status: result.status,
            errorCode: result.errorCode,
          }),
        );
        return;
      }
      setFeedback({ kind: "revokeSuccess" });
      await Promise.all([loadDetail(selectedUser.userId), loadList({ background: true })]);
    } catch {
      setFeedback({ kind: "genericError" });
    } finally {
      setPendingGrantId(null);
    }
  }

  const emptyMessage = canManage
    ? t("mail.adminCenter.permission.empty")
    : t("mail.adminCenter.permission.noPermission");

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.permission")}
        description={t("mail.adminCenter.descriptions.permission")}
        action={
          canManage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void loadList()}
            >
              {t("mail.adminCenter.permission.refresh")}
            </Button>
          ) : null
        }
      />

      {!canManage ? (
        <MailAdminEmptyState message={emptyMessage} />
      ) : loading ? (
        <MailAdminLoadingState />
      ) : error ? (
        <MailAdminErrorState message={error} onRetry={() => void loadList()} />
      ) : rows.length === 0 ? (
        <MailAdminEmptyState message={emptyMessage} />
      ) : (
        <div className={MAIL_ADMIN_CARD_STACK_CLASS}>
          {rows.map((row) => {
            const grantCount =
              grantsByUserId.get(row.userId)?.filter((grant) => grant.revokedAt === null)
                .length ?? 0;
            return (
              <PermissionUserMobileCard
                key={row.userId}
                row={row}
                grantCount={grantCount}
                onOpen={openUser}
              />
            );
          })}
        </div>
      )}

      {selectedUser && typeof document !== "undefined"
        ? createPortal(
            <QuickEntryDrawer
              open
              rootClassName="qe-drawer-root--stacked"
              title={selectedUser.name}
              description={selectedUser.email}
              onRequestClose={closeUser}
              closeLabel={t("common.close")}
            >
              <div className="mail-permission-detail-panel space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <CrmRoleBadge role={selectedUser.crmRole} />
                  <MailAccessLifecycleBadge
                    lifecycle={selectedUser.mailAccessLifecycle}
                  />
                </div>

                <PermissionFeedbackPanel feedback={feedback} />

                {detailLoading ? (
                  <MailAdminLoadingState compact />
                ) : detailError ? (
                  <MailAdminErrorState
                    message={detailError}
                    onRetry={() => void loadDetail(selectedUser.userId)}
                  />
                ) : (
                  <>
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold crm-text">
                        {t("mail.adminCenter.permission.currentGrantsTitle")}
                      </h4>
                      <PermissionGrantList
                        grants={selectedGrantRows}
                        targetIsRootCrmAdmin={selectedUser.isRootCrmAdmin}
                        canManageSuperAdmin={canManageSuperAdmin}
                        pendingGrantId={pendingGrantId}
                        onRevoke={handleRevoke}
                      />
                    </div>

                    {!selectedUser.isRootCrmAdmin &&
                    grantablePermissions.length > 0 ? (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold crm-text">
                          {t("mail.adminCenter.permission.addGrantTitle")}
                        </h4>
                        <div className="space-y-2">
                          {grantablePermissions.map((permission) => (
                            <div
                              key={permission}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border crm-border px-3 py-3"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium crm-text">
                                  {t(mailAdminPermissionLabelKey(permission))}
                                </p>
                                <p className="text-xs crm-text-secondary">
                                  {permission}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                disabled={pendingGrantId === permission}
                                onClick={() => void handleGrant(permission)}
                              >
                                {t("mail.adminCenter.permission.grantAction")}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selectedUser.isRootCrmAdmin ? (
                      <p className="text-xs crm-text-secondary">
                        {t("mail.adminCenter.permission.rootAdminGrantHint")}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </QuickEntryDrawer>,
            document.body,
          )
        : null}
    </div>
  );
}
