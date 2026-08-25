"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  createSenderIdentity,
  fetchMailboxesForSenderIdentity,
  fetchSenderIdentities,
  postSenderIdentityRestore,
  postSenderIdentitySuspend,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  buildSenderIdentityRows,
  canManageSenderIdentity,
  filterActiveMailboxOptions,
  readDefaultSenderIdentityId,
  resolveSenderIdentityRowActions,
  writeDefaultSenderIdentityId,
  type SenderIdentityMailboxOption,
  type SenderIdentityRow,
} from "@/lib/mail/client/sender-identity-management";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

function SenderIdentityStatusBadge({
  status,
}: {
  status: SenderIdentityRow["status"];
}) {
  const { t } = useTranslation();
  const variant =
    status === "active" ? "success" : status === "suspended" ? "warning" : "default";
  return (
    <Badge variant={variant}>
      {t(`mail.adminCenter.senderIdentity.status.${status}`)}
    </Badge>
  );
}

function SenderIdentityDefaultBadge({ isDefault }: { isDefault: boolean }) {
  const { t } = useTranslation();
  if (!isDefault) {
    return (
      <span className="text-sm crm-text-secondary">
        {t("mail.adminCenter.senderIdentity.notDefault")}
      </span>
    );
  }
  return (
    <Badge variant="accent">
      {t("mail.adminCenter.senderIdentity.defaultSender")}
    </Badge>
  );
}

function SenderIdentityRowActions({
  row,
  canManage,
  pending,
  onEnable,
  onDisable,
  onSetDefault,
}: {
  row: SenderIdentityRow;
  canManage: boolean;
  pending: boolean;
  onEnable: (identityId: string) => void;
  onDisable: (identityId: string) => void;
  onSetDefault: (identityId: string) => void;
}) {
  const { t } = useTranslation();
  const actions = resolveSenderIdentityRowActions(row, canManage);

  if (!actions.showEnable && !actions.showDisable && !actions.showSetDefault) {
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
          {t("mail.adminCenter.senderIdentity.enable")}
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
          {t("mail.adminCenter.senderIdentity.disable")}
        </Button>
      ) : null}
      {actions.showSetDefault ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => onSetDefault(row.id)}
        >
          {t("mail.adminCenter.senderIdentity.setDefault")}
        </Button>
      ) : null}
    </div>
  );
}

function SenderIdentityMobileCard({
  row,
  canManage,
  pending,
  onEnable,
  onDisable,
  onSetDefault,
}: {
  row: SenderIdentityRow;
  canManage: boolean;
  pending: boolean;
  onEnable: (identityId: string) => void;
  onDisable: (identityId: string) => void;
  onSetDefault: (identityId: string) => void;
}) {
  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium crm-text">
          {row.displayName ?? row.address}
        </p>
        <p className="truncate break-all text-sm crm-text-secondary">{row.address}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SenderIdentityStatusBadge status={row.status} />
        <SenderIdentityDefaultBadge isDefault={row.isDefaultSender} />
      </div>
      <SenderIdentityRowActions
        row={row}
        canManage={canManage}
        pending={pending}
        onEnable={onEnable}
        onDisable={onDisable}
        onSetDefault={onSetDefault}
      />
    </Card>
  );
}

export function SenderIdentityManagement() {
  const { t } = useTranslation();
  const { session, capabilities } = useMailSession();
  const selfUserId = session?.user.id ?? null;
  const canManage = canManageSenderIdentity(capabilities);

  const [rows, setRows] = useState<SenderIdentityRow[]>([]);
  const [mailboxes, setMailboxes] = useState<SenderIdentityMailboxOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingIdentityId, setPendingIdentityId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newDefaultMailboxId, setNewDefaultMailboxId] = useState("");

  const load = useCallback(async () => {
    if (!canManage || !selfUserId) {
      setRows([]);
      setMailboxes([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [identitiesResult, mailboxesResult] = await Promise.all([
        fetchSenderIdentities(),
        fetchMailboxesForSenderIdentity(),
      ]);

      if (!identitiesResult.ok) {
        setRows([]);
        setMailboxes([]);
        setError(identitiesResult.error);
        return;
      }

      const defaultSenderIdentityId = readDefaultSenderIdentityId(selfUserId);
      setRows(
        buildSenderIdentityRows(identitiesResult.items, defaultSenderIdentityId),
      );

      if (mailboxesResult.ok) {
        setMailboxes(filterActiveMailboxOptions(mailboxesResult.items));
      } else {
        setMailboxes([]);
      }
    } catch {
      setRows([]);
      setMailboxes([]);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [canManage, selfUserId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const mailboxOptions = useMemo(
    () => filterActiveMailboxOptions(mailboxes),
    [mailboxes],
  );

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !newAddress.trim() || !newDefaultMailboxId) return;

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await createSenderIdentity({
        address: newAddress.trim(),
        displayName: newDisplayName.trim() || undefined,
        defaultMailboxId: newDefaultMailboxId,
      });
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setNewAddress("");
      setNewDisplayName("");
      setActionMessage(t("mail.adminCenter.senderIdentity.createSuccess"));
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(identityId: string) {
    if (!canManage) return;
    setPendingIdentityId(identityId);
    setActionMessage(null);
    try {
      const result = await postSenderIdentitySuspend(identityId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.senderIdentity.disableSuccess"));
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingIdentityId(null);
    }
  }

  async function handleEnable(identityId: string) {
    if (!canManage) return;
    setPendingIdentityId(identityId);
    setActionMessage(null);
    try {
      const result = await postSenderIdentityRestore(identityId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.senderIdentity.enableSuccess"));
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setPendingIdentityId(null);
    }
  }

  function handleSetDefault(identityId: string) {
    if (!canManage || !selfUserId) return;
    writeDefaultSenderIdentityId(selfUserId, identityId);
    setRows((current) =>
      current.map((row) => ({
        ...row,
        isDefaultSender: row.id === identityId,
      })),
    );
    setActionMessage(t("mail.adminCenter.senderIdentity.setDefaultSuccess"));
  }

  const emptyMessage = canManage
    ? t("mail.adminCenter.senderIdentity.empty")
    : t("mail.adminCenter.senderIdentity.noPermission");

  const pending = pendingIdentityId !== null || busy;

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.senderIdentity")}
        description={t("mail.adminCenter.descriptions.senderIdentity")}
        action={
          canManage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading || pending}
              onClick={() => void load()}
            >
              {t("mail.adminCenter.senderIdentity.refresh")}
            </Button>
          ) : null
        }
      />

      <p className="text-sm crm-text-secondary">
        {t("mail.adminCenter.senderIdentity.systemSenderHint")}
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
                  <SenderIdentityMobileCard
                    key={row.id}
                    row={row}
                    canManage={canManage}
                    pending={pendingIdentityId === row.id}
                    onEnable={handleEnable}
                    onDisable={handleDisable}
                    onSetDefault={handleSetDefault}
                  />
                ))}
              </div>

              <TableShell className="hidden md:block">
                <DataTable>
                  <TableHead>
                    <Tr>
                      <Th>{t("mail.adminCenter.senderIdentity.columns.displayName")}</Th>
                      <Th>{t("mail.adminCenter.senderIdentity.columns.email")}</Th>
                      <Th>{t("mail.adminCenter.senderIdentity.columns.status")}</Th>
                      <Th>{t("mail.adminCenter.senderIdentity.columns.defaultSender")}</Th>
                      {canManage ? (
                        <Th className="text-right">
                          {t("mail.adminCenter.senderIdentity.columns.actions")}
                        </Th>
                      ) : null}
                    </Tr>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <Tr key={row.id}>
                        <Td>{row.displayName ?? t("mail.adminCenter.senderIdentity.notApplicable")}</Td>
                        <Td>
                          <span className="break-all">{row.address}</span>
                        </Td>
                        <Td>
                          <SenderIdentityStatusBadge status={row.status} />
                        </Td>
                        <Td>
                          <SenderIdentityDefaultBadge isDefault={row.isDefaultSender} />
                        </Td>
                        {canManage ? (
                          <Td className="text-right">
                            <SenderIdentityRowActions
                              row={row}
                              canManage={canManage}
                              pending={pendingIdentityId === row.id}
                              onEnable={handleEnable}
                              onDisable={handleDisable}
                              onSetDefault={handleSetDefault}
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
                {t("mail.adminCenter.senderIdentity.createTitle")}
              </h3>
              <div>
                <Label htmlFor="sender-identity-display-name">
                  {t("mail.adminCenter.senderIdentity.displayNameLabel")}
                </Label>
                <Input
                  id="sender-identity-display-name"
                  type="text"
                  value={newDisplayName}
                  onChange={(event) => setNewDisplayName(event.target.value)}
                  placeholder={t("mail.adminCenter.senderIdentity.displayNamePlaceholder")}
                  disabled={busy}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="sender-identity-address">
                  {t("mail.adminCenter.senderIdentity.emailLabel")}
                </Label>
                <Input
                  id="sender-identity-address"
                  type="email"
                  value={newAddress}
                  onChange={(event) => setNewAddress(event.target.value)}
                  placeholder={t("mail.adminCenter.senderIdentity.emailPlaceholder")}
                  disabled={busy}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="sender-identity-mailbox">
                  {t("mail.adminCenter.senderIdentity.mailboxLabel")}
                </Label>
                <select
                  id="sender-identity-mailbox"
                  value={newDefaultMailboxId}
                  onChange={(event) => setNewDefaultMailboxId(event.target.value)}
                  disabled={busy || mailboxOptions.length === 0}
                  required
                  className="surface-input mt-1 w-full text-sm"
                >
                  <option value="">
                    {t("mail.adminCenter.senderIdentity.mailboxPlaceholder")}
                  </option>
                  {mailboxOptions.map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.id}>
                      {mailbox.displayName
                        ? `${mailbox.displayName} (${mailbox.address})`
                        : mailbox.address}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={busy || !newAddress.trim() || !newDefaultMailboxId}
              >
                {t("mail.adminCenter.senderIdentity.createAction")}
              </Button>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
