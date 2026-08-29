"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import { invalidateComposeContextCache } from "@/lib/mail/client/compose-context-cache";
import {
  fetchAdminUsersForMailAccess,
  fetchMailboxes,
  fetchMailboxMembers,
  fetchSenderIdentityGrants,
  grantSenderIdentityAccess,
  revokeSenderIdentityGrant,
} from "@/lib/mail/client/api";
import type { SenderIdentityApiItem } from "@/lib/mail/client/sender-identity-management";
import {
  buildSenderIdentityGrantRows,
  filterGrantPickerUsers,
  mapGrantUserOptions,
  resolveComposeMailboxView,
  resolveSenderIdentityGrantEligibility,
  type SenderIdentityGrantApiItem,
  type SenderIdentityGrantUserOption,
} from "@/lib/mail/client/sender-identity-grant-management";
import type { MailboxApiItem } from "@/lib/mail/client/mailbox-management";
import type { MailboxMemberApiItem } from "@/lib/mail/client/shared-mailbox-management";
import {
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_TRUNCATE_EMAIL_CLASS,
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
} from "./mail-admin-states";

function GrantUserCard({
  name,
  email,
  roleLabel,
  canSend,
  canReply,
  mailboxSendAuthorized,
  sendAuthorizedLabel,
  sendUnauthorizedLabel,
  replyAuthorizedLabel,
  replyUnauthorizedLabel,
  mailboxSendCapableLabel,
  mailboxSendNotCapableLabel,
  revokeLabel,
  missingMailboxSendLabel,
  busy,
  onRevoke,
}: {
  name: string;
  email: string;
  roleLabel: string;
  canSend: boolean;
  canReply: boolean;
  mailboxSendAuthorized: boolean;
  sendAuthorizedLabel: string;
  sendUnauthorizedLabel: string;
  replyAuthorizedLabel: string;
  replyUnauthorizedLabel: string;
  mailboxSendCapableLabel: string;
  mailboxSendNotCapableLabel: string;
  revokeLabel: string;
  missingMailboxSendLabel: string;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <Card padding className="space-y-3 p-4">
      <div className="min-w-0">
        <p className="truncate font-medium crm-text">{name}</p>
        <p className={MAIL_ADMIN_TRUNCATE_EMAIL_CLASS + " text-sm crm-text-secondary"}>
          {email}
        </p>
        <p className="text-sm crm-text-secondary">{roleLabel}</p>
      </div>
      <div className="space-y-1 text-sm crm-text-secondary">
        <p>{canSend ? sendAuthorizedLabel : sendUnauthorizedLabel}</p>
        <p>{canReply ? replyAuthorizedLabel : replyUnauthorizedLabel}</p>
        <p>
          {mailboxSendAuthorized ? mailboxSendCapableLabel : mailboxSendNotCapableLabel}
        </p>
      </div>
      {!mailboxSendAuthorized && canSend ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {missingMailboxSendLabel}
        </p>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={onRevoke}
      >
        {revokeLabel}
      </Button>
    </Card>
  );
}

export function SenderIdentityGrantPanel({
  open,
  identity,
  onClose,
  onUpdated,
}: {
  open: boolean;
  identity: SenderIdentityApiItem | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<SenderIdentityGrantApiItem[]>([]);
  const [users, setUsers] = useState<SenderIdentityGrantUserOption[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxApiItem[]>([]);
  const [members, setMembers] = useState<MailboxMemberApiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [grantCanSend, setGrantCanSend] = useState(true);
  const [grantCanReply, setGrantCanReply] = useState(false);

  const composeMailbox = useMemo(
    () =>
      identity
        ? resolveComposeMailboxView(identity, mailboxes, users)
        : null,
    [identity, mailboxes, users],
  );

  const mailboxRecord = useMemo(
    () =>
      composeMailbox
        ? (mailboxes.find((mailbox) => mailbox.id === composeMailbox.mailboxId) ??
          null)
        : null,
    [composeMailbox, mailboxes],
  );

  const grantRows = useMemo(
    () => buildSenderIdentityGrantRows(grants, users, mailboxRecord, members),
    [grants, users, mailboxRecord, members],
  );

  const pickerUsers = useMemo(
    () => filterGrantPickerUsers(users, grants, pickerQuery),
    [users, grants, pickerQuery],
  );

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  const selectedEligibility = useMemo(
    () =>
      selectedUser
        ? resolveSenderIdentityGrantEligibility(
            selectedUser.id,
            mailboxRecord,
            members,
          )
        : null,
    [selectedUser, mailboxRecord, members],
  );

  const load = useCallback(async () => {
    if (!open || !identity) {
      setGrants([]);
      setUsers([]);
      setMailboxes([]);
      setMembers([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [grantsResult, usersResult, mailboxesResult] = await Promise.all([
        fetchSenderIdentityGrants(identity.id),
        fetchAdminUsersForMailAccess(),
        fetchMailboxes(),
      ]);

      if (!grantsResult.ok) {
        setGrants([]);
        setError(grantsResult.error);
        return;
      }

      const mappedUsers = mapGrantUserOptions(
        usersResult.ok ? usersResult.items : [],
      );
      const mailboxItems = mailboxesResult.ok ? mailboxesResult.items : [];
      const composeMailboxId =
        identity.defaultMailboxId ?? identity.sentFolderMailboxId;

      let memberItems: MailboxMemberApiItem[] = [];
      if (composeMailboxId) {
        const membersResult = await fetchMailboxMembers(composeMailboxId);
        if (membersResult.ok) {
          memberItems = membersResult.items;
        }
      }

      setGrants(grantsResult.items);
      setUsers(mappedUsers);
      setMailboxes(mailboxItems);
      setMembers(memberItems);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [identity, open, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) {
      setPickerQuery("");
      setSelectedUserId("");
      setGrantCanSend(true);
      setGrantCanReply(false);
      setActionMessage(null);
      setError(null);
    }
  }, [open]);

  async function handleGrant(event: React.FormEvent) {
    event.preventDefault();
    if (!identity || !selectedUserId || busy) {
      return;
    }
    if (grantCanSend && !selectedEligibility?.canGrantCanSend) {
      setActionMessage(
        t("mail.adminCenter.senderIdentity.grants.missingMailboxSendAuthorization"),
      );
      return;
    }
    if (grantCanReply && !selectedEligibility?.canGrantCanReply) {
      setActionMessage(
        t("mail.adminCenter.senderIdentity.grants.missingMailboxReplyAuthorization"),
      );
      return;
    }
    if (!grantCanSend && !grantCanReply) {
      setActionMessage(t("mail.adminCenter.senderIdentity.grants.permissionRequired"));
      return;
    }

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await grantSenderIdentityAccess(identity.id, {
        targetUserId: selectedUserId,
        canSend: grantCanSend,
        canReply: grantCanReply,
      });
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.senderIdentity.grants.grantSuccess"));
      invalidateComposeContextCache();
      setSelectedUserId("");
      setPickerQuery("");
      await load();
      onUpdated();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(grantId: string) {
    if (busy) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const result = await revokeSenderIdentityGrant(grantId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(t("mail.adminCenter.senderIdentity.grants.revokeSuccess"));
      invalidateComposeContextCache();
      await load();
      onUpdated();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (!open || !identity) {
    return null;
  }

  const sendAuthorizedLabel = t(
    "mail.adminCenter.senderIdentity.grants.sendStatusAuthorized",
  );
  const sendUnauthorizedLabel = t(
    "mail.adminCenter.senderIdentity.grants.sendStatusUnauthorized",
  );
  const replyAuthorizedLabel = t(
    "mail.adminCenter.senderIdentity.grants.replyStatusAuthorized",
  );
  const replyUnauthorizedLabel = t(
    "mail.adminCenter.senderIdentity.grants.replyStatusUnauthorized",
  );
  const mailboxSendCapableLabel = t(
    "mail.adminCenter.senderIdentity.grants.mailboxSendCapable",
  );
  const mailboxSendNotCapableLabel = t(
    "mail.adminCenter.senderIdentity.grants.mailboxSendNotCapable",
  );
  const missingMailboxSendLabel = t(
    "mail.adminCenter.senderIdentity.grants.missingMailboxSendAuthorization",
  );
  const revokeLabel = t("mail.adminCenter.senderIdentity.grants.revokeAction");

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="mx-4 max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto p-4 sm:p-6">
        <div className="space-y-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold crm-text">
              {t("mail.adminCenter.senderIdentity.grants.title")}
            </h2>
            <p className="mt-1 truncate text-sm crm-text-secondary">
              {identity.displayName ?? identity.address}
            </p>
            <p className={MAIL_ADMIN_TRUNCATE_EMAIL_CLASS + " text-sm crm-text-secondary"}>
              {identity.address}
            </p>
          </div>

          {composeMailbox ? (
            <Card padding className="min-w-0 space-y-1 p-4 text-sm">
              <p className="font-medium crm-text">
                {t("mail.adminCenter.senderIdentity.grants.composeMailboxTitle")}
              </p>
              <p className="truncate crm-text">
                {composeMailbox.displayName ?? composeMailbox.address}
              </p>
              <p className={MAIL_ADMIN_TRUNCATE_EMAIL_CLASS + " crm-text-secondary"}>
                {composeMailbox.address}
              </p>
              <p className="crm-text-secondary">
                {composeMailbox.mailboxType === "personal"
                  ? t("mail.adminCenter.senderIdentity.grants.personalMailboxOwner", {
                      owner: composeMailbox.ownerLabel,
                    })
                  : t("mail.adminCenter.senderIdentity.grants.sharedMailboxHint")}
              </p>
            </Card>
          ) : (
            <p className="text-sm crm-text-secondary">
              {t("mail.adminCenter.senderIdentity.grants.missingComposeMailbox")}
            </p>
          )}

          {actionMessage ? (
            <p className="text-sm crm-text-secondary" role="status">
              {actionMessage}
            </p>
          ) : null}

          {loading ? (
            <MailAdminLoadingState />
          ) : error ? (
            <MailAdminErrorState message={error} onRetry={() => void load()} />
          ) : (
            <>
              <div>
                <h3 className="text-sm font-semibold crm-text">
                  {t("mail.adminCenter.senderIdentity.grants.authorizedUsersTitle")}
                </h3>
                {grantRows.length === 0 ? (
                  <MailAdminEmptyState
                    message={t("mail.adminCenter.senderIdentity.grants.empty")}
                    compact
                    className="mt-3"
                  />
                ) : (
                  <div className={`${MAIL_ADMIN_CARD_STACK_CLASS} mt-3`}>
                    {grantRows.map((row) => (
                      <GrantUserCard
                        key={row.grantId}
                        name={row.name}
                        email={row.email}
                        roleLabel={
                          row.role === "admin"
                            ? t("mail.adminCenter.overview.rootAdminRole")
                            : t("mail.adminCenter.senderIdentity.grants.staffRole")
                        }
                        canSend={row.canSend}
                        canReply={row.canReply}
                        mailboxSendAuthorized={row.mailboxSendAuthorized}
                        sendAuthorizedLabel={sendAuthorizedLabel}
                        sendUnauthorizedLabel={sendUnauthorizedLabel}
                        replyAuthorizedLabel={replyAuthorizedLabel}
                        replyUnauthorizedLabel={replyUnauthorizedLabel}
                        mailboxSendCapableLabel={mailboxSendCapableLabel}
                        mailboxSendNotCapableLabel={mailboxSendNotCapableLabel}
                        revokeLabel={revokeLabel}
                        missingMailboxSendLabel={missingMailboxSendLabel}
                        busy={busy}
                        onRevoke={() => void handleRevoke(row.grantId)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <Card padding className="space-y-3 p-4 md:p-6">
                <h3 className="text-sm font-semibold crm-text">
                  {t("mail.adminCenter.senderIdentity.grants.addTitle")}
                </h3>
                <form className="space-y-3" onSubmit={(event) => void handleGrant(event)}>
                  <div>
                    <Label htmlFor="sender-grant-user-search">
                      {t("mail.adminCenter.senderIdentity.grants.userSearchLabel")}
                    </Label>
                    <Input
                      id="sender-grant-user-search"
                      type="search"
                      value={pickerQuery}
                      onChange={(event) => setPickerQuery(event.target.value)}
                      placeholder={t(
                        "mail.adminCenter.senderIdentity.grants.userSearchPlaceholder",
                      )}
                      disabled={busy}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="sender-grant-user">
                      {t("mail.adminCenter.senderIdentity.grants.userSelectLabel")}
                    </Label>
                    <select
                      id="sender-grant-user"
                      value={selectedUserId}
                      onChange={(event) => setSelectedUserId(event.target.value)}
                      disabled={busy || pickerUsers.length === 0}
                      required
                      className="surface-input mt-1 w-full text-sm"
                    >
                      <option value="">
                        {t("mail.adminCenter.senderIdentity.grants.userSelectPlaceholder")}
                      </option>
                      {pickerUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {`${user.name} · ${user.email} · ${
                            user.role === "admin"
                              ? t("mail.adminCenter.overview.rootAdminRole")
                              : t("mail.adminCenter.senderIdentity.grants.staffRole")
                          }`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedUser && selectedEligibility ? (
                    <div className="space-y-2 text-sm">
                      <p
                        className={
                          selectedEligibility.mailboxSendAuthorized
                            ? "crm-text-secondary"
                            : "text-amber-700 dark:text-amber-300"
                        }
                      >
                        {selectedEligibility.mailboxSendAuthorized
                          ? mailboxSendCapableLabel
                          : t(
                              "mail.adminCenter.senderIdentity.grants.userMissingMailboxSendAuthorization",
                              { name: selectedUser.name },
                            )}
                      </p>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={grantCanSend}
                          onChange={(event) => setGrantCanSend(event.target.checked)}
                          disabled={busy || !selectedEligibility.canGrantCanSend}
                        />
                        <span>
                          {t("mail.adminCenter.senderIdentity.grants.canSendLabel")}
                        </span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={grantCanReply}
                          onChange={(event) => setGrantCanReply(event.target.checked)}
                          disabled={busy || !selectedEligibility.canGrantCanReply}
                        />
                        <span>
                          {t("mail.adminCenter.senderIdentity.grants.canReplyLabel")}
                        </span>
                      </label>
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      busy ||
                      !selectedUserId ||
                      (!grantCanSend && !grantCanReply) ||
                      (grantCanSend && !selectedEligibility?.canGrantCanSend)
                    }
                  >
                    {t("mail.adminCenter.senderIdentity.grants.addAction")}
                  </Button>
                </form>
              </Card>
            </>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
