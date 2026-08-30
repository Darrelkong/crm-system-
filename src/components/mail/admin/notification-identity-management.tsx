"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
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
  createNotificationIdentity,
  fetchNotificationIdentities,
  issueSelfNotificationVerificationToken,
  verifyNotificationIdentity,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  canIssueSelfVerificationToken,
  canManageNotificationIdentity,
  clearVerificationTokenModalPayload,
  filterSelfNotificationIdentities,
  findActivePendingNotificationIdentity,
  resolveNotificationIdentityDisplayStatus,
  resolveNotificationIdentityManagementActions,
  resolveNotificationIdentityUxPhase,
  resolvePrimaryNotificationIdentity,
  shouldShowAdvancedVerificationTools,
  type NotificationIdentityApiItem,
  type NotificationIdentityDisplayStatus,
  type VerificationTokenModalPayload,
} from "@/lib/mail/client/notification-identity-management";
import {
  VERIFICATION_CODE_INPUT_PROPS,
  normalizeVerificationCodeFieldValue,
  parseNotificationVerificationErrorMetadata,
  resolveNotificationVerificationErrorMessage,
} from "@/lib/mail/client/notification-verification-client";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

function statusBadgeVariant(
  status: NotificationIdentityDisplayStatus,
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

function statusPanelClassName(
  status: NotificationIdentityDisplayStatus,
): string {
  switch (status) {
    case "verified":
      return "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30";
    case "pending":
      return "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30";
    case "bounced":
    case "revoked":
      return "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30";
    default:
      return "crm-border bg-black/[0.02] dark:bg-white/[0.03]";
  }
}

function NotificationIdentityStatusBadge({
  item,
}: {
  item: NotificationIdentityApiItem;
}) {
  const { t } = useTranslation();
  const status = resolveNotificationIdentityDisplayStatus(item);
  return (
    <Badge variant={statusBadgeVariant(status)}>
      {t(`mail.adminCenter.notificationIdentity.status.${status}`)}
    </Badge>
  );
}

function IdentityStatusPanel({
  item,
}: {
  item: NotificationIdentityApiItem;
}) {
  const { t } = useTranslation();
  const status = resolveNotificationIdentityDisplayStatus(item);

  const stateMessageKey =
    status === "verified"
      ? "verifiedStateMessage"
      : status === "revoked"
        ? "revokedStateMessage"
        : status === "bounced"
          ? "bouncedStateMessage"
          : null;

  return (
    <Card padding className={`space-y-3 border p-4 md:p-6 ${statusPanelClassName(status)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <NotificationIdentityStatusBadge item={item} />
      </div>
      <div className="space-y-1">
        <p className="break-all text-sm font-medium crm-text">{item.email}</p>
        {stateMessageKey ? (
          <p className="text-sm crm-text-secondary">
            {t(`mail.adminCenter.notificationIdentity.${stateMessageKey}`)}
          </p>
        ) : null}
        {status === "pending" ? (
          <p className="text-sm crm-text-secondary">
            {t("mail.adminCenter.notificationIdentity.verifyHint", {
              email: item.email,
            })}
          </p>
        ) : null}
        {item.verifiedAt ? (
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
    </Card>
  );
}

function VerificationTokenModal({
  payload,
  onClose,
}: {
  payload: VerificationTokenModalPayload;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(payload.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="mx-4 w-full max-w-lg overflow-hidden p-0">
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <h3 className="text-lg font-semibold crm-text">
            {t("mail.adminCenter.notificationIdentity.tokenModalTitle")}
          </h3>
          <p className="mt-2 break-words text-sm crm-text-secondary">
            {t("mail.adminCenter.notificationIdentity.tokenModalHint")}
          </p>
          <p className="mt-1 text-xs crm-text-secondary">
            {t("mail.adminCenter.notificationIdentity.tokenExpiresAt", {
              date: formatHongKongDateTime(payload.expiresAt),
            })}
          </p>
          <textarea
            readOnly
            value={payload.token}
            className="surface-input mt-4 w-full resize-none font-mono text-xs"
            rows={3}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopy()}>
              {copied
                ? t("mail.adminCenter.notificationIdentity.tokenCopied")
                : t("mail.adminCenter.notificationIdentity.copyToken")}
            </Button>
            <Button type="button" size="sm" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}

function NotificationIdentityVerifyForm({
  busy,
  verifyCodeInput,
  onVerifyCodeChange,
  onSubmit,
}: {
  busy: boolean;
  verifyCodeInput: string;
  onVerifyCodeChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card padding className="p-4 md:p-6">
      <form className="space-y-3" onSubmit={onSubmit}>
        <h3 className="text-sm font-semibold crm-text">
          {t("mail.adminCenter.notificationIdentity.verifyTitle")}
        </h3>
        <div>
          <Label htmlFor="notification-verify-code">
            {t("mail.adminCenter.notificationIdentity.verifyCodeLabel")}
          </Label>
          <Input
            id="notification-verify-code"
            type="text"
            value={verifyCodeInput}
            onChange={(event) =>
              onVerifyCodeChange(
                normalizeVerificationCodeFieldValue(event.target.value),
              )
            }
            placeholder={t(
              "mail.adminCenter.notificationIdentity.verifyCodePlaceholder",
            )}
            disabled={busy}
            required
            className="mt-1 font-mono uppercase tracking-widest"
            {...VERIFICATION_CODE_INPUT_PROPS}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={
            busy ||
            verifyCodeInput.length !== VERIFICATION_CODE_INPUT_PROPS.maxLength
          }
        >
          {t("mail.adminCenter.notificationIdentity.verifyAction")}
        </Button>
      </form>
    </Card>
  );
}

function AdvancedVerificationTools({
  busy,
  onIssueToken,
}: {
  busy: boolean;
  onIssueToken: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card padding className="space-y-3 border-dashed p-4 md:p-6">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold crm-text">
          {t("mail.adminCenter.notificationIdentity.advancedTitle")}
        </h3>
        <p className="text-sm crm-text-secondary">
          {t("mail.adminCenter.notificationIdentity.advancedHint")}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={onIssueToken}
      >
        {t("mail.adminCenter.notificationIdentity.issueToken")}
      </Button>
    </Card>
  );
}

export function NotificationIdentityManagement() {
  const { t } = useTranslation();
  const { session, capabilities } = useMailSession();
  const selfUserId = session?.user.id ?? null;

  const canManage = canManageNotificationIdentity(capabilities);
  const canIssueToken = canIssueSelfVerificationToken(capabilities);

  const [items, setItems] = useState<NotificationIdentityApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [verifyCodeInput, setVerifyCodeInput] = useState("");
  const [tokenModal, setTokenModal] = useState<VerificationTokenModalPayload | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!selfUserId || !canManage) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetchNotificationIdentities(selfUserId);
      if (!result.ok) {
        setError(result.error);
        setItems([]);
        return;
      }
      setItems(filterSelfNotificationIdentities(result.items, selfUserId));
    } catch {
      setError(t("common.networkError"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [canManage, selfUserId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(
    () => findActivePendingNotificationIdentity(items),
    [items],
  );
  const primaryIdentity = useMemo(
    () => resolvePrimaryNotificationIdentity(items),
    [items],
  );
  const uxPhase = useMemo(
    () => resolveNotificationIdentityUxPhase(items),
    [items],
  );
  const actions = useMemo(
    () =>
      resolveNotificationIdentityManagementActions({
        canManage,
        canIssueToken,
        pending,
      }),
    [canManage, canIssueToken, pending],
  );
  const showAdvancedTools = shouldShowAdvancedVerificationTools({
    canIssueToken,
    pending,
  });

  function closeTokenModal() {
    setTokenModal(clearVerificationTokenModalPayload());
  }

  async function handleAddEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!selfUserId || !canManage || !newEmail.trim()) return;

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await createNotificationIdentity(selfUserId, newEmail.trim());
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      if (result.item.userId !== selfUserId) {
        setActionMessage(t("mail.adminCenter.notificationIdentity.selfOnlyError"));
        return;
      }
      setNewEmail("");
      setActionMessage(t("mail.adminCenter.notificationIdentity.createSuccess"));
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleIssueToken() {
    if (!canManage || !canIssueToken || !pending) return;

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await issueSelfNotificationVerificationToken();
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setTokenModal({
        token: result.verificationToken,
        expiresAt: result.expiresAt,
      });
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !pending || !verifyCodeInput.trim()) return;

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await verifyNotificationIdentity(
        pending.id,
        normalizeVerificationCodeFieldValue(verifyCodeInput),
      );
      if (!result.ok) {
        const localized = resolveNotificationVerificationErrorMessage(
          t,
          parseNotificationVerificationErrorMetadata(result.metadata),
        );
        setActionMessage(localized ?? result.error);
        await load();
        return;
      }
      if (result.item.userId !== selfUserId) {
        setActionMessage(t("mail.adminCenter.notificationIdentity.selfOnlyError"));
        return;
      }
      setVerifyCodeInput("");
      setActionMessage(t("mail.adminCenter.notificationIdentity.verifySuccess"));
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const emptyMessage = canManage
    ? t("mail.adminCenter.notificationIdentity.empty")
    : t("mail.adminCenter.notificationIdentity.noPermission");

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.notificationIdentity")}
        description={t("mail.adminCenter.descriptions.notificationIdentity")}
        action={
          canManage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading || busy}
              onClick={() => void load()}
            >
              {t("mail.adminCenter.notificationIdentity.refresh")}
            </Button>
          ) : null
        }
      />

      <p className="text-sm crm-text-secondary">
        {t("mail.adminCenter.notificationIdentity.selfOnlyHint")}
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
          {uxPhase === "empty" ? (
            <MailAdminEmptyState message={emptyMessage} />
          ) : primaryIdentity ? (
            <IdentityStatusPanel item={primaryIdentity} />
          ) : null}

          {primaryIdentity && uxPhase !== "empty" ? (
            <>
              <div className={`${MAIL_ADMIN_CARD_STACK_CLASS} md:hidden`}>
                <Card padding className="space-y-2 p-4 md:p-6">
                  <NotificationIdentityStatusBadge item={primaryIdentity} />
                  <p className="break-all text-sm crm-text">{primaryIdentity.email}</p>
                </Card>
              </div>

              <TableShell className="hidden md:block">
                <DataTable>
                  <TableHead>
                    <Tr>
                      <Th>{t("mail.adminCenter.notificationIdentity.columns.email")}</Th>
                      <Th>{t("mail.adminCenter.notificationIdentity.columns.status")}</Th>
                      <Th>{t("mail.adminCenter.notificationIdentity.columns.date")}</Th>
                    </Tr>
                  </TableHead>
                  <TableBody>
                    <Tr>
                      <Td>{primaryIdentity.email}</Td>
                      <Td>
                        <NotificationIdentityStatusBadge item={primaryIdentity} />
                      </Td>
                      <Td>
                        {primaryIdentity.verifiedAt
                          ? formatHongKongDateTime(primaryIdentity.verifiedAt)
                          : primaryIdentity.verificationExpiresAt &&
                              uxPhase === "pending"
                            ? formatHongKongDateTime(
                                primaryIdentity.verificationExpiresAt,
                              )
                            : primaryIdentity.revokedAt
                              ? formatHongKongDateTime(primaryIdentity.revokedAt)
                              : t("mail.adminCenter.notificationIdentity.notApplicable")}
                      </Td>
                    </Tr>
                  </TableBody>
                </DataTable>
              </TableShell>
            </>
          ) : null}

          {actions.showAddEmail ? (
            <Card padding className="p-4 md:p-6">
              <form className="space-y-3" onSubmit={(event) => void handleAddEmail(event)}>
                <h3 className="text-sm font-semibold crm-text">
                  {t("mail.adminCenter.notificationIdentity.addTitle")}
                </h3>
                <div>
                  <Label htmlFor="notification-identity-email">
                    {t("mail.adminCenter.notificationIdentity.addEmailLabel")}
                  </Label>
                  <Input
                    id="notification-identity-email"
                    type="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder={t("mail.adminCenter.notificationIdentity.addEmailPlaceholder")}
                    disabled={busy}
                    required
                    className="mt-1"
                  />
                </div>
                <Button type="submit" size="sm" disabled={busy || !newEmail.trim()}>
                  {t("mail.adminCenter.notificationIdentity.addAction")}
                </Button>
              </form>
            </Card>
          ) : null}

          {pending && actions.showVerify ? (
            <NotificationIdentityVerifyForm
              busy={busy}
              verifyCodeInput={verifyCodeInput}
              onVerifyCodeChange={setVerifyCodeInput}
              onSubmit={(event) => void handleVerify(event)}
            />
          ) : null}

          {showAdvancedTools ? (
            <AdvancedVerificationTools
              busy={busy}
              onIssueToken={() => void handleIssueToken()}
            />
          ) : null}
        </>
      )}

      {tokenModal ? (
        <VerificationTokenModal payload={tokenModal} onClose={closeTokenModal} />
      ) : null}
    </div>
  );
}
