"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
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
  createMailbox,
  fetchAdminUsersForMailAccess,
  fetchMailAccessList,
  fetchMailboxes,
  postMailboxRestore,
  postMailboxSuspend,
} from "@/lib/mail/client/api";
import {
  buildCreateMailboxRequest,
  buildMailboxRows,
  canManageMailboxes,
  isMailboxCreateSubmitEnabled,
  listPersonalMailboxOwnerCandidates,
  resolveMailboxRowActions,
  resolveMailboxTypeChange,
  type MailboxRow,
  type PersonalMailboxOwnerOption,
} from "@/lib/mail/client/mailbox-management";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

function MailboxStatusBadge({ status }: { status: MailboxRow["status"] }) {
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

function MailboxRowActions({
  row,
  canManage,
  pending,
  onEnable,
  onDisable,
}: {
  row: MailboxRow;
  canManage: boolean;
  pending: boolean;
  onEnable: (mailboxId: string) => void;
  onDisable: (mailboxId: string) => void;
}) {
  const { t } = useTranslation();
  const actions = resolveMailboxRowActions(row, canManage);

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
          onClick={() => onEnable(row.id)}
        >
          {t("mail.adminCenter.mailbox.enable")}
        </Button>
      ) : null}
      {actions.showDisable ? (
        <Button
          type="button"
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => onDisable(row.id)}
        >
          {t("mail.adminCenter.mailbox.disable")}
        </Button>
      ) : null}
    </div>
  );
}

function MailboxMobileCard({
  row,
  canManage,
  pending,
  onEnable,
  onDisable,
}: {
  row: MailboxRow;
  canManage: boolean;
  pending: boolean;
  onEnable: (mailboxId: string) => void;
  onDisable: (mailboxId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="min-w-0">
        <p className="truncate break-all text-sm font-medium crm-text">{row.address}</p>
        {row.displayName ? (
          <p className="truncate text-sm crm-text-secondary">{row.displayName}</p>
        ) : null}
      </div>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="crm-text-secondary">{t("mail.adminCenter.mailbox.columns.owner")}</dt>
          <dd className="crm-text">{row.ownerLabel}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="crm-text-secondary">{t("mail.adminCenter.mailbox.columns.status")}</dt>
          <dd>
            <MailboxStatusBadge status={row.status} />
          </dd>
        </div>
        <div>
          <dt className="crm-text-secondary">{t("mail.adminCenter.mailbox.columns.createdAt")}</dt>
          <dd className="crm-text">{formatHongKongDateTime(row.createdAt)}</dd>
        </div>
      </dl>
      <MailboxRowActions
        row={row}
        canManage={canManage}
        pending={pending}
        onEnable={onEnable}
        onDisable={onDisable}
      />
    </Card>
  );
}

export function MailboxManagement() {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const canManage = canManageMailboxes(capabilities);

  const [rows, setRows] = useState<MailboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingMailboxId, setPendingMailboxId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newMailboxType, setNewMailboxType] = useState<"personal" | "shared">("personal");
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [ownerCandidates, setOwnerCandidates] = useState<PersonalMailboxOwnerOption[]>([]);

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
      const [mailboxesResult, usersResult, accessResult] = await Promise.all([
        fetchMailboxes(),
        fetchAdminUsersForMailAccess(),
        fetchMailAccessList(),
      ]);

      if (!mailboxesResult.ok) {
        setRows([]);
        setOwnerCandidates([]);
        setError(mailboxesResult.error);
        return;
      }

      const users = usersResult.ok ? usersResult.items : [];
      const accessItems = accessResult.ok ? accessResult.items : [];
      setOwnerCandidates(listPersonalMailboxOwnerCandidates(users, accessItems));
      setRows(buildMailboxRows(mailboxesResult.items, users));
    } catch {
      setRows([]);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (
      !canManage ||
      !isMailboxCreateSubmitEnabled({
        address: newAddress,
        mailboxType: newMailboxType,
        ownerUserId: newOwnerUserId,
      })
    ) {
      return;
    }

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await createMailbox(
        buildCreateMailboxRequest({
          address: newAddress,
          displayName: newDisplayName,
          mailboxType: newMailboxType,
          ownerUserId: newOwnerUserId,
        }),
      );
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setNewAddress("");
      setNewDisplayName("");
      setNewOwnerUserId("");
      setActionMessage(t("mail.adminCenter.mailbox.createSuccess"));
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(mailboxId: string) {
    if (!canManage) return;
    setPendingMailboxId(mailboxId);
    setActionMessage(null);
    try {
      const result = await postMailboxSuspend(mailboxId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.mailbox.disableSuccess"));
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingMailboxId(null);
    }
  }

  async function handleEnable(mailboxId: string) {
    if (!canManage) return;
    setPendingMailboxId(mailboxId);
    setActionMessage(null);
    try {
      const result = await postMailboxRestore(mailboxId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.mailbox.enableSuccess"));
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingMailboxId(null);
    }
  }

  const emptyMessage = canManage
    ? t("mail.adminCenter.mailbox.empty")
    : t("mail.adminCenter.mailbox.noPermission");

  const pending = pendingMailboxId !== null || busy;

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.mailbox")}
        description={t("mail.adminCenter.descriptions.mailbox")}
        action={
          canManage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading || pending}
              onClick={() => void load()}
            >
              {t("mail.adminCenter.mailbox.refresh")}
            </Button>
          ) : null
        }
      />

      <p className="text-sm crm-text-secondary">
        {t("mail.adminCenter.mailbox.systemDomainHint")}
      </p>

      {actionMessage ? (
        <p className="text-sm crm-text-secondary" role="status">
          {actionMessage}
        </p>
      ) : null}

      {loading ? (
        <MailAdminLoadingState />
      ) : error ? (
        <MailAdminErrorState
          message={error}
          onRetry={canManage ? () => void load() : undefined}
        />
      ) : !canManage ? (
        <MailAdminEmptyState message={emptyMessage} />
      ) : (
        <>
          {rows.length === 0 ? (
            <MailAdminEmptyState message={emptyMessage} />
          ) : (
            <>
              <div className={`${MAIL_ADMIN_CARD_STACK_CLASS} md:hidden`}>
                {rows.map((row) => (
                  <MailboxMobileCard
                    key={row.id}
                    row={row}
                    canManage={canManage}
                    pending={pendingMailboxId === row.id}
                    onEnable={handleEnable}
                    onDisable={handleDisable}
                  />
                ))}
              </div>

              <TableShell className="hidden md:block">
                <DataTable>
                  <TableHead>
                    <Tr>
                      <Th>{t("mail.adminCenter.mailbox.columns.address")}</Th>
                      <Th>{t("mail.adminCenter.mailbox.columns.owner")}</Th>
                      <Th>{t("mail.adminCenter.mailbox.columns.status")}</Th>
                      <Th>{t("mail.adminCenter.mailbox.columns.createdAt")}</Th>
                      {canManage ? (
                        <Th className="text-right">
                          {t("mail.adminCenter.mailbox.columns.actions")}
                        </Th>
                      ) : null}
                    </Tr>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <Tr key={row.id}>
                        <Td>
                          <div className="min-w-0">
                            <p className="break-all">{row.address}</p>
                            {row.displayName ? (
                              <p className="text-xs crm-text-secondary">{row.displayName}</p>
                            ) : null}
                          </div>
                        </Td>
                        <Td>{row.ownerLabel}</Td>
                        <Td>
                          <MailboxStatusBadge status={row.status} />
                        </Td>
                        <Td>{formatHongKongDateTime(row.createdAt)}</Td>
                        {canManage ? (
                          <Td className="text-right">
                            <MailboxRowActions
                              row={row}
                              canManage={canManage}
                              pending={pendingMailboxId === row.id}
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

          <Card padding className="p-4 md:p-6">
            <form className="space-y-3" onSubmit={(event) => void handleCreate(event)}>
              <h3 className="text-sm font-semibold crm-text">
                {t("mail.adminCenter.mailbox.createTitle")}
              </h3>
              <div>
                <Label htmlFor="mailbox-address">
                  {t("mail.adminCenter.mailbox.addressLabel")}
                </Label>
                <Input
                  id="mailbox-address"
                  type="email"
                  value={newAddress}
                  onChange={(event) => setNewAddress(event.target.value)}
                  placeholder={t("mail.adminCenter.mailbox.addressPlaceholder")}
                  disabled={busy}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="mailbox-display-name">
                  {t("mail.adminCenter.mailbox.displayNameLabel")}
                </Label>
                <Input
                  id="mailbox-display-name"
                  type="text"
                  value={newDisplayName}
                  onChange={(event) => setNewDisplayName(event.target.value)}
                  placeholder={t("mail.adminCenter.mailbox.displayNamePlaceholder")}
                  disabled={busy}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="mailbox-type">
                  {t("mail.adminCenter.mailbox.typeLabel")}
                </Label>
                <select
                  id="mailbox-type"
                  value={newMailboxType}
                  onChange={(event) => {
                    const nextType = event.target.value as "personal" | "shared";
                    setNewMailboxType(nextType);
                    setNewOwnerUserId(resolveMailboxTypeChange(nextType, newOwnerUserId));
                  }}
                  disabled={busy}
                  className="surface-input mt-1 w-full text-sm"
                >
                  <option value="personal">
                    {t("mail.adminCenter.mailbox.typePersonal")}
                  </option>
                  <option value="shared">
                    {t("mail.adminCenter.mailbox.typeShared")}
                  </option>
                </select>
              </div>
              {newMailboxType === "personal" ? (
                <div>
                  <Label htmlFor="mailbox-owner-user">
                    {t("mail.adminCenter.mailbox.ownerLabel")}
                  </Label>
                  <select
                    id="mailbox-owner-user"
                    value={newOwnerUserId}
                    onChange={(event) => setNewOwnerUserId(event.target.value)}
                    disabled={busy || ownerCandidates.length === 0}
                    required
                    className="surface-input mt-1 w-full text-sm"
                  >
                    <option value="">
                      {t("mail.adminCenter.mailbox.ownerPlaceholder")}
                    </option>
                    {ownerCandidates.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name || user.email}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Button
                type="submit"
                size="sm"
                disabled={
                  busy ||
                  !isMailboxCreateSubmitEnabled({
                    address: newAddress,
                    mailboxType: newMailboxType,
                    ownerUserId: newOwnerUserId,
                  })
                }
              >
                {t("mail.adminCenter.mailbox.createAction")}
              </Button>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
