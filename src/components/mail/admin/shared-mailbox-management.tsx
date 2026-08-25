"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { QuickEntryDrawer } from "@/components/ui/quick-entry-drawer";
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
  fetchMailboxes,
  fetchMailboxMembers,
  grantMailboxMember,
  revokeMailboxMember,
  updateMailboxMemberPermissions,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import type { MailAccessAdminUser } from "@/lib/mail/client/mail-access-management";
import {
  buildSharedMailboxMemberRows,
  buildSharedMailboxRows,
  canManageSharedMailboxes,
  hasAnyMemberPermission,
  memberPermissionsFromRole,
  resolveSharedMailboxMemberRowActions,
  type MailboxMemberPermissionDraft,
  type SharedMailboxMemberRow,
  type SharedMailboxRow,
} from "@/lib/mail/client/shared-mailbox-management";
import type { MailboxMemberRoleLabel } from "@/lib/mail/mailbox-member-serialization";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

const PERMISSION_KEYS: (keyof MailboxMemberPermissionDraft)[] = [
  "canRead",
  "canReply",
  "canSend",
  "canAssign",
  "canManageProcessing",
  "canAddInternalNote",
];

function SharedMailboxStatusBadge({ status }: { status: SharedMailboxRow["status"] }) {
  const { t } = useTranslation();
  const variant =
    status === "active"
      ? "success"
      : status === "suspended"
        ? "warning"
        : "default";
  return (
    <Badge variant={variant}>
      {t(`mail.adminCenter.mailbox.status.${status}`)}
    </Badge>
  );
}

function MemberRoleBadge({ role }: { role: MailboxMemberRoleLabel }) {
  const { t } = useTranslation();
  return <Badge variant="default">{t(`mail.adminCenter.sharedMailbox.role.${role}`)}</Badge>;
}

function PermissionChecklist({
  draft,
  onChange,
  disabled,
}: {
  draft: MailboxMemberPermissionDraft;
  onChange: (next: MailboxMemberPermissionDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PERMISSION_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-2 text-sm crm-text">
          <input
            type="checkbox"
            checked={draft[key]}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...draft,
                [key]: event.target.checked,
              })
            }
          />
          {t(`mail.adminCenter.sharedMailbox.permissions.${key}`)}
        </label>
      ))}
    </div>
  );
}

function MemberPermissionsSummary({ row }: { row: SharedMailboxMemberRow }) {
  const { t } = useTranslation();
  const enabled = PERMISSION_KEYS.filter((key) => row[key]);
  if (enabled.length === 0) {
    return <span className="text-sm crm-text-secondary">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {enabled.map((key) => (
        <Badge key={key} variant="default">
          {t(`mail.adminCenter.sharedMailbox.permissions.${key}`)}
        </Badge>
      ))}
    </div>
  );
}

function SharedMailboxMobileCard({
  row,
  onOpen,
}: {
  row: SharedMailboxRow;
  onOpen: (mailboxId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium crm-text">
          {row.displayName ?? row.address}
        </p>
        <p className="truncate break-all text-sm crm-text-secondary">{row.address}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SharedMailboxStatusBadge status={row.status} />
        <span className="text-xs crm-text-secondary">
          {t("mail.adminCenter.sharedMailbox.memberCount", {
            count: String(row.memberCount),
          })}
        </span>
      </div>
      <p className="text-xs crm-text-secondary">
        {formatHongKongDateTime(row.createdAt)}
      </p>
      <Button type="button" size="sm" onClick={() => onOpen(row.id)}>
        {t("mail.adminCenter.sharedMailbox.manageMembers")}
      </Button>
    </Card>
  );
}

export function SharedMailboxManagement() {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const canManage = canManageSharedMailboxes(capabilities);

  const [rows, setRows] = useState<SharedMailboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedMailbox, setSelectedMailbox] = useState<SharedMailboxRow | null>(null);
  const [members, setMembers] = useState<SharedMailboxMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MailboxMemberPermissionDraft | null>(null);
  const [newMemberUserId, setNewMemberUserId] = useState("");
  const [newMemberRole, setNewMemberRole] =
    useState<Exclude<MailboxMemberRoleLabel, "custom">>("reply");
  const [adminUsers, setAdminUsers] = useState<MailAccessAdminUser[]>([]);

  const loadMailboxes = useCallback(async () => {
    if (!canManage) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [mailboxesResult, usersResult] = await Promise.all([
        fetchMailboxes(),
        fetchAdminUsersForMailAccess(),
      ]);
      if (!mailboxesResult.ok) {
        setRows([]);
        setError(mailboxesResult.error);
        return;
      }
      if (usersResult.ok) {
        setAdminUsers(usersResult.items);
      }

      const sharedMailboxes = mailboxesResult.items.filter(
        (item) => item.mailboxType === "shared",
      );
      const memberResults = await Promise.all(
        sharedMailboxes.map((mailbox) => fetchMailboxMembers(mailbox.id)),
      );
      const memberCountsByMailboxId = new Map<string, number>();
      for (const [index, result] of memberResults.entries()) {
        const mailbox = sharedMailboxes[index];
        if (mailbox && result.ok) {
          memberCountsByMailboxId.set(mailbox.id, result.items.length);
        }
      }
      setRows(
        buildSharedMailboxRows(mailboxesResult.items, memberCountsByMailboxId),
      );
    } catch {
      setRows([]);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  const loadMembers = useCallback(
    async (mailboxId: string) => {
      setMembersLoading(true);
      setMembersError(null);
      try {
        const [membersResult, usersResult] = await Promise.all([
          fetchMailboxMembers(mailboxId),
          fetchAdminUsersForMailAccess(),
        ]);
        if (!membersResult.ok) {
          setMembers([]);
          setMembersError(membersResult.error);
          return;
        }
        const users = usersResult.ok ? usersResult.items : adminUsers;
        if (usersResult.ok) {
          setAdminUsers(usersResult.items);
        }
        setMembers(buildSharedMailboxMemberRows(membersResult.items, users));
      } catch {
        setMembers([]);
        setMembersError(t("common.networkError"));
      } finally {
        setMembersLoading(false);
      }
    },
    [adminUsers, t],
  );

  useEffect(() => {
    void loadMailboxes();
  }, [loadMailboxes]);

  useEffect(() => {
    if (selectedMailbox) {
      void loadMembers(selectedMailbox.id);
    } else {
      setMembers([]);
      setMembersError(null);
      setEditingMemberId(null);
      setEditDraft(null);
      setNewMemberUserId("");
    }
  }, [loadMembers, selectedMailbox]);

  const availableUsers = useMemo(() => {
    const memberUserIds = new Set(members.map((member) => member.userId));
    return adminUsers.filter(
      (user) => user.status !== "deleted" && !memberUserIds.has(user.id),
    );
  }, [adminUsers, members]);

  async function handleAddMember(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !selectedMailbox || !newMemberUserId) return;
    const permissions = memberPermissionsFromRole(newMemberRole);
    if (!hasAnyMemberPermission(permissions)) return;

    setPendingMemberId("new");
    setActionMessage(null);
    try {
      const result = await grantMailboxMember(selectedMailbox.id, {
        targetUserId: newMemberUserId,
        ...permissions,
      });
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setNewMemberUserId("");
      setActionMessage(t("mail.adminCenter.sharedMailbox.addMemberSuccess"));
      await Promise.all([loadMembers(selectedMailbox.id), loadMailboxes()]);
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingMemberId(null);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!canManage || !selectedMailbox) return;
    setPendingMemberId(memberId);
    setActionMessage(null);
    try {
      const result = await revokeMailboxMember(memberId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.sharedMailbox.removeMemberSuccess"));
      setEditingMemberId(null);
      setEditDraft(null);
      await Promise.all([loadMembers(selectedMailbox.id), loadMailboxes()]);
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingMemberId(null);
    }
  }

  async function handleSaveMemberPermissions(memberId: string) {
    if (!canManage || !selectedMailbox || !editDraft) return;
    if (!hasAnyMemberPermission(editDraft)) return;

    setPendingMemberId(memberId);
    setActionMessage(null);
    try {
      const result = await updateMailboxMemberPermissions(memberId, editDraft);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.sharedMailbox.updateMemberSuccess"));
      setEditingMemberId(null);
      setEditDraft(null);
      await loadMembers(selectedMailbox.id);
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingMemberId(null);
    }
  }

  if (!canManage) {
    return (
      <div className={MAIL_ADMIN_SECTION_CLASS}>
        <PageIntro
          title={t("mail.adminCenter.sections.sharedMailbox")}
          description={t("mail.adminCenter.descriptions.sharedMailbox")}
        />
        <MailAdminEmptyState message={t("mail.adminCenter.sharedMailbox.noPermission")} />
      </div>
    );
  }

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        title={t("mail.adminCenter.sections.sharedMailbox")}
        description={t("mail.adminCenter.descriptions.sharedMailbox")}
      />

      <p className="text-sm crm-text-secondary">
        {t("mail.adminCenter.sharedMailbox.systemDomainHint")}
      </p>

      {actionMessage ? (
        <p className="text-sm crm-text" role="status">
          {actionMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadMailboxes()}>
          {t("mail.adminCenter.sharedMailbox.refresh")}
        </Button>
      </div>

      {loading ? (
        <MailAdminLoadingState />
      ) : error ? (
        <MailAdminErrorState message={error} onRetry={() => void loadMailboxes()} />
      ) : rows.length === 0 ? (
        <MailAdminEmptyState message={t("mail.adminCenter.sharedMailbox.empty")} />
      ) : (
        <div className={MAIL_ADMIN_CARD_STACK_CLASS}>
          <Card padding className="p-4 md:p-6">
            <div className="hidden md:block">
              <TableShell>
                <DataTable>
                  <TableHead>
                    <Tr>
                      <Th>{t("mail.adminCenter.sharedMailbox.columns.address")}</Th>
                      <Th>{t("mail.adminCenter.sharedMailbox.columns.displayName")}</Th>
                      <Th>{t("mail.adminCenter.sharedMailbox.columns.memberCount")}</Th>
                      <Th>{t("mail.adminCenter.sharedMailbox.columns.status")}</Th>
                      <Th>{t("mail.adminCenter.sharedMailbox.columns.createdAt")}</Th>
                      <Th>{t("mail.adminCenter.sharedMailbox.columns.actions")}</Th>
                    </Tr>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <Tr key={row.id}>
                        <Td>{row.address}</Td>
                        <Td>{row.displayName ?? t("mail.adminCenter.mailbox.notApplicable")}</Td>
                        <Td>{row.memberCount}</Td>
                        <Td>
                          <SharedMailboxStatusBadge status={row.status} />
                        </Td>
                        <Td>{formatHongKongDateTime(row.createdAt)}</Td>
                        <Td>
                          <Button type="button" size="sm" onClick={() => setSelectedMailbox(row)}>
                            {t("mail.adminCenter.sharedMailbox.manageMembers")}
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </TableBody>
                </DataTable>
              </TableShell>
            </div>

            <div className="space-y-3 md:hidden">
              {rows.map((row) => (
                <SharedMailboxMobileCard
                  key={row.id}
                  row={row}
                  onOpen={(mailboxId) => {
                    const match = rows.find((entry) => entry.id === mailboxId) ?? null;
                    setSelectedMailbox(match);
                  }}
                />
              ))}
            </div>
          </Card>
        </div>
      )}

      <QuickEntryDrawer
        open={selectedMailbox != null}
        title={
          selectedMailbox
            ? selectedMailbox.displayName ?? selectedMailbox.address
            : t("mail.adminCenter.sharedMailbox.detailTitle")
        }
        description={selectedMailbox?.address}
        onRequestClose={() => setSelectedMailbox(null)}
        closeLabel={t("common.close")}
      >
        {selectedMailbox ? (
          <div className="space-y-4">
            {membersLoading ? (
              <MailAdminLoadingState compact />
            ) : membersError ? (
              <MailAdminErrorState
                message={membersError}
                onRetry={() => void loadMembers(selectedMailbox.id)}
              />
            ) : (
              <>
                <Card padding className="space-y-3 p-4">
                  <h4 className="text-sm font-semibold crm-text">
                    {t("mail.adminCenter.sharedMailbox.membersTitle")}
                  </h4>
                  {members.length === 0 ? (
                    <MailAdminEmptyState
                      compact
                      message={t("mail.adminCenter.sharedMailbox.membersEmpty")}
                    />
                  ) : (
                    <div className="space-y-3">
                      {members.map((member) => {
                        const actions = resolveSharedMailboxMemberRowActions(canManage);
                        const editing = editingMemberId === member.id;
                        return (
                          <div
                            key={member.id}
                            className="rounded-lg border crm-border px-3 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium crm-text">{member.userLabel}</p>
                                <div className="mt-1">
                                  <MemberRoleBadge role={member.roleLabel} />
                                </div>
                              </div>
                              {actions.showEdit || actions.showRemove ? (
                                <div className="flex flex-wrap gap-2">
                                  {actions.showEdit ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      disabled={pendingMemberId === member.id}
                                      onClick={() => {
                                        setEditingMemberId(member.id);
                                        setEditDraft({
                                          canRead: member.canRead,
                                          canReply: member.canReply,
                                          canSend: member.canSend,
                                          canAssign: member.canAssign,
                                          canManageProcessing: member.canManageProcessing,
                                          canAddInternalNote: member.canAddInternalNote,
                                        });
                                      }}
                                    >
                                      {t("mail.adminCenter.sharedMailbox.editMember")}
                                    </Button>
                                  ) : null}
                                  {actions.showRemove ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="danger"
                                      disabled={pendingMemberId === member.id}
                                      onClick={() => void handleRemoveMember(member.id)}
                                    >
                                      {t("mail.adminCenter.sharedMailbox.removeMember")}
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            {!editing ? (
                              <div className="mt-3">
                                <MemberPermissionsSummary row={member} />
                              </div>
                            ) : editDraft ? (
                              <div className="mt-3 space-y-3">
                                <PermissionChecklist
                                  draft={editDraft}
                                  onChange={setEditDraft}
                                  disabled={pendingMemberId === member.id}
                                />
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={
                                      pendingMemberId === member.id ||
                                      !hasAnyMemberPermission(editDraft)
                                    }
                                    onClick={() => void handleSaveMemberPermissions(member.id)}
                                  >
                                    {t("mail.adminCenter.sharedMailbox.saveMember")}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                      setEditingMemberId(null);
                                      setEditDraft(null);
                                    }}
                                  >
                                    {t("common.cancel")}
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>

                <Card padding className="space-y-3 p-4">
                  <h4 className="text-sm font-semibold crm-text">
                    {t("mail.adminCenter.sharedMailbox.addMemberTitle")}
                  </h4>
                  <form onSubmit={(event) => void handleAddMember(event)} className="space-y-3">
                    <div>
                      <Label htmlFor="shared-mailbox-member-user">
                        {t("mail.adminCenter.sharedMailbox.memberUserLabel")}
                      </Label>
                      <select
                        id="shared-mailbox-member-user"
                        className="mt-1 w-full rounded-md border crm-border bg-transparent px-3 py-2 text-sm crm-text"
                        value={newMemberUserId}
                        onChange={(event) => setNewMemberUserId(event.target.value)}
                        disabled={pendingMemberId === "new" || availableUsers.length === 0}
                      >
                        <option value="">
                          {t("mail.adminCenter.sharedMailbox.memberUserPlaceholder")}
                        </option>
                        {availableUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name || user.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="shared-mailbox-member-role">
                        {t("mail.adminCenter.sharedMailbox.memberRoleLabel")}
                      </Label>
                      <select
                        id="shared-mailbox-member-role"
                        className="mt-1 w-full rounded-md border crm-border bg-transparent px-3 py-2 text-sm crm-text"
                        value={newMemberRole}
                        onChange={(event) =>
                          setNewMemberRole(
                            event.target.value as Exclude<MailboxMemberRoleLabel, "custom">,
                          )
                        }
                      >
                        <option value="full">
                          {t("mail.adminCenter.sharedMailbox.role.full")}
                        </option>
                        <option value="reply">
                          {t("mail.adminCenter.sharedMailbox.role.reply")}
                        </option>
                        <option value="read_only">
                          {t("mail.adminCenter.sharedMailbox.role.read_only")}
                        </option>
                      </select>
                    </div>
                    <PermissionChecklist
                      draft={memberPermissionsFromRole(newMemberRole)}
                      onChange={() => undefined}
                      disabled
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={pendingMemberId === "new" || !newMemberUserId}
                    >
                      {t("mail.adminCenter.sharedMailbox.addMemberAction")}
                    </Button>
                  </form>
                </Card>
              </>
            )}
          </div>
        ) : null}
      </QuickEntryDrawer>
    </div>
  );
}
