"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import {
  createSenderIdentity,
  fetchAdminUsersForMailAccess,
  fetchMailboxes,
  fetchMailboxesForSenderIdentity,
  fetchMailboxMembers,
  fetchSenderIdentities,
  fetchSenderIdentityGrants,
  grantSenderIdentityAccess,
  postSenderIdentityRestore,
  postSenderIdentitySuspend,
} from "@/lib/mail/client/api";
import { invalidateComposeContextCache } from "@/lib/mail/client/compose-context-cache";
import { useMailAdminCenterNavigation } from "@/lib/mail/client/mail-admin-center-navigation";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import type { MailboxApiItem } from "@/lib/mail/client/mailbox-management";
import {
  actorHasEligibleSendMailbox,
  countActiveSenderIdentityGrants,
  isSelfGrantSubmitEnabled,
  mapGrantUserOptions,
  resolveComposeMailboxView,
  resolveCreateFormMailboxView,
  resolveCreateIdentitySelfGrantBlockedReason,
} from "@/lib/mail/client/sender-identity-grant-management";
import {
  buildSenderIdentityRows,
  canManageSenderIdentity,
  filterActiveMailboxOptions,
  readDefaultSenderIdentityId,
  resolveSenderIdentityRowActions,
  writeDefaultSenderIdentityId,
  type SenderIdentityApiItem,
  type SenderIdentityMailboxOption,
  type SenderIdentityRow,
} from "@/lib/mail/client/sender-identity-management";
import type { MailboxMemberApiItem } from "@/lib/mail/client/shared-mailbox-management";
import { SenderIdentityGrantPanel } from "./sender-identity-grant-panel";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
  MAIL_ADMIN_TRUNCATE_EMAIL_CLASS,
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
  onManageGrants,
}: {
  row: SenderIdentityRow;
  canManage: boolean;
  pending: boolean;
  onEnable: (identityId: string) => void;
  onDisable: (identityId: string) => void;
  onSetDefault: (identityId: string) => void;
  onManageGrants: (identityId: string) => void;
}) {
  const { t } = useTranslation();
  const actions = resolveSenderIdentityRowActions(row, canManage);

  return (
    <div className="flex flex-wrap gap-2">
      {canManage ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => onManageGrants(row.id)}
        >
          {t("mail.adminCenter.senderIdentity.grants.manageAction")}
        </Button>
      ) : null}
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

function SenderIdentityCard({
  row,
  authorizedUserCount,
  canManage,
  pending,
  onEnable,
  onDisable,
  onSetDefault,
  onManageGrants,
}: {
  row: SenderIdentityRow;
  authorizedUserCount: number;
  canManage: boolean;
  pending: boolean;
  onEnable: (identityId: string) => void;
  onDisable: (identityId: string) => void;
  onSetDefault: (identityId: string) => void;
  onManageGrants: (identityId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="min-w-0">
        <p className="truncate text-base font-medium crm-text">
          {row.displayName ?? row.address}
        </p>
        <p className={MAIL_ADMIN_TRUNCATE_EMAIL_CLASS + " text-sm crm-text-secondary"}>
          {row.address}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SenderIdentityStatusBadge status={row.status} />
        <SenderIdentityDefaultBadge isDefault={row.isDefaultSender} />
      </div>
      <p className="text-sm crm-text-secondary">
        {t("mail.adminCenter.senderIdentity.grants.authorizedUserCount", {
          count: String(authorizedUserCount),
        })}
      </p>
      <SenderIdentityRowActions
        row={row}
        canManage={canManage}
        pending={pending}
        onEnable={onEnable}
        onDisable={onDisable}
        onSetDefault={onSetDefault}
        onManageGrants={onManageGrants}
      />
    </Card>
  );
}

function formatMailboxOptionLabel(
  mailbox: SenderIdentityMailboxOption,
  suffix: string | null,
): string {
  const primary = mailbox.displayName
    ? `${mailbox.displayName} (${mailbox.address})`
    : mailbox.address;
  return suffix ? `${primary} · ${suffix}` : primary;
}

export function SenderIdentityManagement() {
  const { t } = useTranslation();
  const { navigateToSection } = useMailAdminCenterNavigation();
  const { session, capabilities } = useMailSession();
  const selfUserId = session?.user.id ?? null;
  const canManage = canManageSenderIdentity(capabilities);

  const [rows, setRows] = useState<SenderIdentityRow[]>([]);
  const [mailboxes, setMailboxes] = useState<SenderIdentityMailboxOption[]>([]);
  const [mailboxRecords, setMailboxRecords] = useState<MailboxApiItem[]>([]);
  const [sharedMailboxMembers, setSharedMailboxMembers] = useState<
    Record<string, MailboxMemberApiItem[]>
  >({});
  const [grantCounts, setGrantCounts] = useState<Record<string, number>>({});
  const [grantUsers, setGrantUsers] = useState(mapGrantUserOptions([]));
  const [createMailboxMembers, setCreateMailboxMembers] = useState<
    MailboxMemberApiItem[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingIdentityId, setPendingIdentityId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newDefaultMailboxId, setNewDefaultMailboxId] = useState("");
  const [grantSelfOnCreate, setGrantSelfOnCreate] = useState(false);
  const [grantPanelIdentity, setGrantPanelIdentity] =
    useState<SenderIdentityApiItem | null>(null);

  const loadSharedMailboxMembers = useCallback(
    async (records: MailboxApiItem[]) => {
      const sharedMailboxes = records.filter(
        (mailbox) =>
          mailbox.status === "active" && mailbox.mailboxType === "shared",
      );
      const entries = await Promise.all(
        sharedMailboxes.map(async (mailbox) => {
          const result = await fetchMailboxMembers(mailbox.id);
          return [mailbox.id, result.ok ? result.items : []] as const;
        }),
      );
      setSharedMailboxMembers(Object.fromEntries(entries));
    },
    [],
  );

  const loadGrantCounts = useCallback(async (items: SenderIdentityApiItem[]) => {
    const entries = await Promise.all(
      items.map(async (item) => {
        const result = await fetchSenderIdentityGrants(item.id);
        return [
          item.id,
          result.ok ? countActiveSenderIdentityGrants(result.items) : 0,
        ] as const;
      }),
    );
    setGrantCounts(Object.fromEntries(entries));
  }, []);

  const load = useCallback(async () => {
    if (!canManage || !selfUserId) {
      setRows([]);
      setMailboxes([]);
      setMailboxRecords([]);
      setSharedMailboxMembers({});
      setGrantCounts({});
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [identitiesResult, mailboxesResult, fullMailboxesResult, usersResult] =
        await Promise.all([
          fetchSenderIdentities(),
          fetchMailboxesForSenderIdentity(),
          fetchMailboxes(),
          fetchAdminUsersForMailAccess(),
        ]);

      if (!identitiesResult.ok) {
        setRows([]);
        setMailboxes([]);
        setMailboxRecords([]);
        setError(identitiesResult.error);
        return;
      }

      const defaultSenderIdentityId = readDefaultSenderIdentityId(selfUserId);
      setRows(
        buildSenderIdentityRows(identitiesResult.items, defaultSenderIdentityId),
      );
      setGrantUsers(mapGrantUserOptions(usersResult.ok ? usersResult.items : []));

      if (mailboxesResult.ok) {
        setMailboxes(filterActiveMailboxOptions(mailboxesResult.items));
      } else {
        setMailboxes([]);
      }

      const records = fullMailboxesResult.ok ? fullMailboxesResult.items : [];
      setMailboxRecords(records);
      await loadSharedMailboxMembers(records);
      await loadGrantCounts(identitiesResult.items);
    } catch {
      setRows([]);
      setMailboxes([]);
      setMailboxRecords([]);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [canManage, loadGrantCounts, loadSharedMailboxMembers, selfUserId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!newDefaultMailboxId) {
      setCreateMailboxMembers([]);
      return;
    }
    let cancelled = false;
    void fetchMailboxMembers(newDefaultMailboxId).then((result) => {
      if (cancelled) return;
      setCreateMailboxMembers(result.ok ? result.items : []);
    });
    return () => {
      cancelled = true;
    };
  }, [newDefaultMailboxId]);

  const mailboxOptions = useMemo(
    () => filterActiveMailboxOptions(mailboxes),
    [mailboxes],
  );

  const selectedCreateMailbox = useMemo(
    () =>
      mailboxRecords.find((mailbox) => mailbox.id === newDefaultMailboxId) ?? null,
    [mailboxRecords, newDefaultMailboxId],
  );

  const selectedCreateMailboxView = useMemo(() => {
    if (!selectedCreateMailbox) {
      return null;
    }
    return resolveCreateFormMailboxView(
      selectedCreateMailbox,
      grantUsers,
      selfUserId,
      createMailboxMembers,
    );
  }, [createMailboxMembers, grantUsers, selectedCreateMailbox, selfUserId]);

  const selectedComposeMailboxView = useMemo(() => {
    if (!selectedCreateMailbox) {
      return null;
    }
    return resolveComposeMailboxView(
      {
        id: "draft",
        address: newAddress,
        displayName: newDisplayName || null,
        status: "active",
        defaultMailboxId: selectedCreateMailbox.id,
        sentFolderMailboxId: null,
        aliasOfIdentityId: null,
        createdBy: null,
        createdAt: "",
        updatedAt: "",
      },
      mailboxRecords,
      grantUsers,
    );
  }, [
    grantUsers,
    mailboxRecords,
    newAddress,
    newDisplayName,
    selectedCreateMailbox,
  ]);

  const hasEligibleSendMailbox = useMemo(() => {
    if (!selfUserId) {
      return false;
    }
    return actorHasEligibleSendMailbox(
      mailboxRecords,
      selfUserId,
      sharedMailboxMembers,
    );
  }, [mailboxRecords, selfUserId, sharedMailboxMembers]);

  const mailboxOptionViews = useMemo(() => {
    const views = new Map<
      string,
      ReturnType<typeof resolveCreateFormMailboxView>
    >();
    for (const option of mailboxOptions) {
      const record =
        mailboxRecords.find((mailbox) => mailbox.id === option.id) ?? null;
      if (!record) {
        continue;
      }
      views.set(
        option.id,
        resolveCreateFormMailboxView(
          record,
          grantUsers,
          selfUserId,
          record.mailboxType === "shared"
            ? (sharedMailboxMembers[record.id] ?? [])
            : [],
        ),
      );
    }
    return views;
  }, [grantUsers, mailboxOptions, mailboxRecords, selfUserId, sharedMailboxMembers]);

  const selfGrantBlockedReason = resolveCreateIdentitySelfGrantBlockedReason({
    grantSelfOnCreate,
    selfUserId,
    mailbox: selectedCreateMailbox,
    members: createMailboxMembers,
  });

  const createSubmitEnabled =
    Boolean(newAddress.trim() && newDefaultMailboxId) &&
    isSelfGrantSubmitEnabled({
      grantSelfOnCreate,
      defaultMailboxId: newDefaultMailboxId,
      selfUserId,
      mailbox: selectedCreateMailbox,
      members: createMailboxMembers,
    });

  function resolveMailboxOptionSuffix(mailboxId: string): string | null {
    const view = mailboxOptionViews.get(mailboxId);
    if (!view) {
      return null;
    }
    if (view.mailboxType === "personal") {
      if (view.ownerLabel) {
        return t("mail.adminCenter.senderIdentity.grants.personalMailboxOwner", {
          owner: view.ownerLabel,
        });
      }
      return view.actorCanSend
        ? t("mail.adminCenter.senderIdentity.grants.mailboxOptionActorCanSend")
        : t("mail.adminCenter.senderIdentity.grants.mailboxOptionActorCannotSend");
    }
    if (view.actorCanSend) {
      return t("mail.adminCenter.senderIdentity.grants.mailboxOptionActorCanSend");
    }
    return t("mail.adminCenter.senderIdentity.grants.mailboxOptionNotSendCapable");
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !createSubmitEnabled) return;

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

      if (grantSelfOnCreate && selfUserId) {
        const grantResult = await grantSenderIdentityAccess(result.item.id, {
          targetUserId: selfUserId,
          canSend: true,
        });
        if (!grantResult.ok) {
          setActionMessage(grantResult.error);
          await load();
          return;
        }
      }

      invalidateComposeContextCache();

      setNewAddress("");
      setNewDisplayName("");
      setNewDefaultMailboxId("");
      setGrantSelfOnCreate(false);
      setActionMessage(
        grantSelfOnCreate
          ? t("mail.adminCenter.senderIdentity.createWithSelfGrantSuccess")
          : t("mail.adminCenter.senderIdentity.createSuccess"),
      );
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
      invalidateComposeContextCache();
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
      invalidateComposeContextCache();
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

  function handleManageGrants(identityId: string) {
    const identity = rows.find((row) => row.id === identityId);
    if (!identity) return;
    setGrantPanelIdentity(identity);
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
            <div className={MAIL_ADMIN_CARD_STACK_CLASS}>
              {rows.map((row) => (
                <SenderIdentityCard
                  key={row.id}
                  row={row}
                  authorizedUserCount={grantCounts[row.id] ?? 0}
                  canManage={canManage}
                  pending={pendingIdentityId === row.id || busy}
                  onEnable={handleEnable}
                  onDisable={handleDisable}
                  onSetDefault={handleSetDefault}
                  onManageGrants={handleManageGrants}
                />
              ))}
            </div>
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
                <p className="mt-1 text-sm crm-text-secondary">
                  {t("mail.adminCenter.senderIdentity.mailboxHelper")}
                </p>
                {!hasEligibleSendMailbox ? (
                  <MailAdminEmptyState
                    compact
                    className="mt-3"
                    message={t(
                      "mail.adminCenter.senderIdentity.grants.noEligibleSendMailbox",
                    )}
                    action={
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => navigateToSection("mailbox")}
                      >
                        {t("mail.adminCenter.senderIdentity.grants.goToMailboxAccess")}
                      </Button>
                    }
                  />
                ) : null}
                <select
                  id="sender-identity-mailbox"
                  value={newDefaultMailboxId}
                  onChange={(event) => setNewDefaultMailboxId(event.target.value)}
                  disabled={busy || mailboxOptions.length === 0}
                  required
                  className="surface-input mt-3 w-full text-sm"
                >
                  <option value="">
                    {t("mail.adminCenter.senderIdentity.mailboxPlaceholder")}
                  </option>
                  {mailboxOptions.map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.id}>
                      {formatMailboxOptionLabel(
                        mailbox,
                        resolveMailboxOptionSuffix(mailbox.id),
                      )}
                    </option>
                  ))}
                </select>
                {selectedCreateMailboxView ? (
                  <div className="mt-2 space-y-1 text-sm crm-text-secondary">
                    {selectedComposeMailboxView?.mailboxType === "personal" ? (
                      <p>
                        {t("mail.adminCenter.senderIdentity.grants.personalMailboxOwner", {
                          owner: selectedComposeMailboxView.ownerLabel,
                        })}
                      </p>
                    ) : (
                      <p>
                        {t("mail.adminCenter.senderIdentity.grants.sharedMailboxHint")}
                      </p>
                    )}
                    <p>
                      {selectedCreateMailboxView.actorCanSend
                        ? t(
                            "mail.adminCenter.senderIdentity.grants.mailboxOptionActorCanSend",
                          )
                        : t(
                            "mail.adminCenter.senderIdentity.grants.mailboxOptionActorCannotSend",
                          )}
                    </p>
                  </div>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-sm crm-text">
                <input
                  type="checkbox"
                  checked={grantSelfOnCreate}
                  onChange={(event) => setGrantSelfOnCreate(event.target.checked)}
                  disabled={
                    busy ||
                    !selfUserId ||
                    !hasEligibleSendMailbox ||
                    (selectedCreateMailboxView != null &&
                      !selectedCreateMailboxView.actorCanSend)
                  }
                />
                <span>{t("mail.adminCenter.senderIdentity.grantSelfOnCreateLabel")}</span>
              </label>
              {selfGrantBlockedReason === "missingMailboxSendAuthorization" ? (
                <div className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
                  <p>{t("mail.adminCenter.senderIdentity.grantSelfOnCreateBlocked")}</p>
                  <p>{t("mail.adminCenter.senderIdentity.grantSelfOnCreateSetupHint")}</p>
                </div>
              ) : null}
              {!hasEligibleSendMailbox ? (
                <p className="text-sm crm-text-secondary">
                  {t("mail.adminCenter.senderIdentity.grants.createPersonalMailboxHint")}
                </p>
              ) : null}
              <Button type="submit" size="sm" disabled={busy || !createSubmitEnabled}>
                {t("mail.adminCenter.senderIdentity.createAction")}
              </Button>
            </form>
          </Card>
        </>
      )}

      <SenderIdentityGrantPanel
        open={grantPanelIdentity != null}
        identity={grantPanelIdentity}
        onClose={() => setGrantPanelIdentity(null)}
        onUpdated={() => void load()}
      />
    </div>
  );
}
