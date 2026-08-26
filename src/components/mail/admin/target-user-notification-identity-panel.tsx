"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import {
  createNotificationIdentity,
  fetchNotificationIdentities,
  sendTargetNotificationVerificationChallenge,
  verifyNotificationIdentity,
} from "@/lib/mail/client/api";
import {
  findActivePendingNotificationIdentity,
  findActiveVerifiedNotificationIdentity,
  resolveNotificationIdentityDisplayStatus,
  type NotificationIdentityApiItem,
} from "@/lib/mail/client/notification-identity-management";
import { formatHongKongDateTime } from "@/lib/timezone";

export function TargetUserNotificationIdentityPanel({
  open,
  targetUserId,
  targetUserName,
  targetUserEmail,
  onClose,
  onUpdated,
}: {
  open: boolean;
  targetUserId: string | null;
  targetUserName: string;
  targetUserEmail: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationIdentityApiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [verifyCodeInput, setVerifyCodeInput] = useState("");

  const verified = useMemo(
    () => findActiveVerifiedNotificationIdentity(items),
    [items],
  );
  const pending = useMemo(
    () => findActivePendingNotificationIdentity(items),
    [items],
  );
  const primary = verified ?? pending;

  const load = useCallback(async () => {
    if (!open || !targetUserId) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetchNotificationIdentities(targetUserId);
      if (!result.ok) {
        setError(result.error);
        setItems([]);
        return;
      }
      setItems(result.items);
    } catch {
      setError(t("common.networkError"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [open, targetUserId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) {
      setNewEmail("");
      setVerifyCodeInput("");
      setActionMessage(null);
      setError(null);
    }
  }, [open]);

  if (!open || !targetUserId) {
    return null;
  }

  async function handleAddEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!newEmail.trim()) return;

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await createNotificationIdentity(targetUserId!, newEmail.trim());
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setNewEmail("");
      setActionMessage(t("mail.adminCenter.notificationIdentity.createSuccess"));
      await load();
      onUpdated();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendVerification() {
    if (!pending) return;

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await sendTargetNotificationVerificationChallenge(targetUserId!);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      if (result.delivery.status === "transport_disabled") {
        setActionMessage(
          t("mail.adminCenter.access.targetNotification.transportDisabled"),
        );
      } else if (result.delivery.status === "queued") {
        setActionMessage(
          t("mail.adminCenter.access.targetNotification.sendQueued", {
            email: result.delivery.destinationEmail,
          }),
        );
      } else if (result.delivery.status === "delivery_failed") {
        setActionMessage(
          t("mail.adminCenter.access.targetNotification.deliveryFailed"),
        );
      } else {
        setActionMessage(
          t("mail.adminCenter.access.targetNotification.sendSuccess", {
            email: result.delivery.destinationEmail,
          }),
        );
      }
      await load();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!pending || !verifyCodeInput.trim()) return;

    setBusy(true);
    setActionMessage(null);
    try {
      const result = await verifyNotificationIdentity(
        pending.id,
        verifyCodeInput.trim(),
      );
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setVerifyCodeInput("");
      setActionMessage(t("mail.adminCenter.notificationIdentity.verifySuccess"));
      await load();
      onUpdated();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="mx-4 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto p-4 sm:p-6">
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold crm-text">
              {t("mail.adminCenter.access.targetNotification.title")}
            </h3>
            <p className="text-sm crm-text-secondary">
              {t("mail.adminCenter.access.targetNotification.description")}
            </p>
            <p className="text-sm font-medium crm-text">{targetUserName}</p>
            <p className="text-sm crm-text-secondary">{targetUserEmail}</p>
          </div>

          {actionMessage ? (
            <p className="text-sm crm-text-secondary" role="status">
              {actionMessage}
            </p>
          ) : null}

          {loading ? (
            <p className="text-sm crm-text-secondary">{t("common.loading")}</p>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : primary ? (
            <Card padding className="space-y-2 border p-4">
              <Badge variant={verified ? "success" : "warning"}>
                {t(
                  `mail.adminCenter.notificationIdentity.status.${resolveNotificationIdentityDisplayStatus(primary)}`,
                )}
              </Badge>
              <p className="break-all text-sm crm-text">{primary.email}</p>
              {pending ? (
                <>
                  <p className="text-sm crm-text-secondary">
                    {t("mail.adminCenter.access.targetNotification.verifyAssistHint", {
                      email: pending.email,
                    })}
                  </p>
                  {pending.verificationExpiresAt ? (
                    <p className="text-xs crm-text-secondary">
                      {t("mail.adminCenter.notificationIdentity.expiresAt")}:{" "}
                      {formatHongKongDateTime(pending.verificationExpiresAt)}
                    </p>
                  ) : null}
                </>
              ) : null}
            </Card>
          ) : (
            <p className="text-sm crm-text-secondary">
              {t("mail.adminCenter.access.targetNotification.empty")}
            </p>
          )}

          {!verified && !pending ? (
            <Card padding className="p-4">
              <form className="space-y-3" onSubmit={(event) => void handleAddEmail(event)}>
                <div>
                  <Label htmlFor="target-notification-email">
                    {t("mail.adminCenter.notificationIdentity.addEmailLabel")}
                  </Label>
                  <Input
                    id="target-notification-email"
                    type="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder={t(
                      "mail.adminCenter.notificationIdentity.addEmailPlaceholder",
                    )}
                    disabled={busy}
                    required
                    className="mt-1"
                  />
                </div>
                <Button type="submit" size="sm" disabled={busy || !newEmail.trim()}>
                  {t("mail.adminCenter.access.targetNotification.addAction")}
                </Button>
              </form>
            </Card>
          ) : null}

          {pending ? (
            <Card padding className="space-y-4 p-4">
              <div className="space-y-2">
                <p className="text-sm crm-text-secondary">
                  {t("mail.adminCenter.access.targetNotification.sendHint")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void handleSendVerification()}
                >
                  {t("mail.adminCenter.access.targetNotification.sendAction")}
                </Button>
              </div>
              <form className="space-y-3" onSubmit={(event) => void handleVerify(event)}>
                <div>
                  <Label htmlFor="target-notification-verify-code">
                    {t("mail.adminCenter.notificationIdentity.verifyCodeLabel")}
                  </Label>
                  <Input
                    id="target-notification-verify-code"
                    type="text"
                    value={verifyCodeInput}
                    onChange={(event) => setVerifyCodeInput(event.target.value)}
                    placeholder={t(
                      "mail.adminCenter.notificationIdentity.verifyCodePlaceholder",
                    )}
                    disabled={busy}
                    required
                    autoComplete="off"
                    className="mt-1"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy || !verifyCodeInput.trim()}
                >
                  {t("mail.adminCenter.access.targetNotification.verifyAction")}
                </Button>
              </form>
            </Card>
          ) : null}

          <div className="flex justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
