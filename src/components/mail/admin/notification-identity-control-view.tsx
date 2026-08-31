"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import {
  cancelPendingNotificationIdentity,
  disableNotificationIdentity,
  fetchNotificationIdentities,
  sendTargetNotificationVerificationChallenge,
} from "@/lib/mail/client/api";
import {
  computePendingVerificationResendCooldownSeconds,
  formatVerificationResendActionLabel,
} from "@/lib/mail/client/notification-verification-client";
import {
  resolveNotificationIdentityStateModel,
  resolveNotificationIdentitySurfaceActions,
  type NotificationIdentityApiItem,
} from "@/lib/mail/client/notification-identity-management";
import { NotificationIdentityDisableConfirmModal } from "./notification-identity-disable-confirm-modal";
import { NotificationIdentityOtpModal } from "./notification-identity-otp-modal";
import { NotificationIdentitySettingsModal } from "./notification-identity-settings-modal";
import { NotificationIdentityStatusSummary } from "./notification-identity-status-summary";
import {
  MailAdminErrorState,
  MailAdminLoadingState,
} from "./mail-admin-states";

type SettingsMode = "configure" | "change" | null;

export function NotificationIdentityControlView({
  targetUserId,
  targetUserName,
  targetUserEmail,
  showMemberHeader = false,
  onUpdated,
}: {
  targetUserId: string;
  targetUserName: string;
  targetUserEmail: string;
  showMemberHeader?: boolean;
  onUpdated?: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationIdentityApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [settingsMode, setSettingsMode] = useState<SettingsMode>(null);
  const [otpOpen, setOtpOpen] = useState(false);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [resendTick, setResendTick] = useState(0);

  const state = useMemo(
    () => resolveNotificationIdentityStateModel(items),
    [items],
  );
  const actions = useMemo(
    () => resolveNotificationIdentitySurfaceActions(state),
    [state],
  );

  const resendCooldownSeconds = useMemo(() => {
    void resendTick;
    return computePendingVerificationResendCooldownSeconds(
      state.pending?.verificationRequestedAt ?? null,
    );
  }, [state.pending?.verificationRequestedAt, resendTick]);

  const completeActionLabel = actions.isReplacementPending
    ? t("mail.notificationMailbox.completeReplacementAction")
    : t("mail.notificationMailbox.completeVerificationAction");

  const cancelActionLabel = actions.isPendingOnly
    ? t("mail.notificationMailbox.cancelSetupAction")
    : t("mail.notificationMailbox.cancelReplacementAction");

  const load = useCallback(async () => {
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
  }, [targetUserId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!state.pending?.verificationRequestedAt) {
      return;
    }
    if (resendCooldownSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setResendTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.pending?.verificationRequestedAt, resendCooldownSeconds]);

  function notifyUpdated() {
    void load();
    onUpdated?.();
  }

  function openOtpModal() {
    setOtpOpen(true);
  }

  async function handleResendVerification() {
    if (!state.pending) return;
    setResendBusy(true);
    setActionMessage(null);
    try {
      const result = await sendTargetNotificationVerificationChallenge(targetUserId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(
        result.delivery.status === "queued"
          ? t("mail.adminCenter.notificationIdentity.verifySentInitial")
          : t("mail.adminCenter.notificationIdentity.verifyResentSuccess"),
      );
      setResendTick((value) => value + 1);
      notifyUpdated();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setResendBusy(false);
    }
  }

  async function handleCancelPending() {
    setLifecycleBusy(true);
    setActionMessage(null);
    try {
      const result = await cancelPendingNotificationIdentity(targetUserId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setActionMessage(
        actions.isPendingOnly
          ? t("mail.notificationMailbox.cancelSetupSuccess")
          : t("mail.notificationMailbox.cancelReplacementSuccess"),
      );
      notifyUpdated();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function handleDisableConfirmed() {
    setLifecycleBusy(true);
    setActionMessage(null);
    try {
      const result = await disableNotificationIdentity(targetUserId);
      if (!result.ok) {
        setActionMessage(result.error);
        return;
      }
      setDisableConfirmOpen(false);
      setActionMessage(t("mail.notificationMailbox.disableSuccess"));
      notifyUpdated();
    } catch {
      setActionMessage(t("common.networkError"));
    } finally {
      setLifecycleBusy(false);
    }
  }

  if (loading) {
    return <MailAdminLoadingState />;
  }

  if (error) {
    return (
      <MailAdminErrorState message={error} onRetry={() => void load()} />
    );
  }

  return (
    <div className="space-y-4">
      {actionMessage ? (
        <p className="text-sm crm-text-secondary" role="status">
          {actionMessage}
        </p>
      ) : null}

      <NotificationIdentityStatusSummary
        items={items}
        accountEmail={targetUserEmail}
        memberName={targetUserName}
        showMemberHeader={showMemberHeader}
      />

      <div className="flex flex-wrap gap-2">
        {actions.showConfigureEmail ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setSettingsMode("configure")}
          >
            {t("mail.adminCenter.access.actions.configureNotificationEmail")}
          </Button>
        ) : null}
        {actions.showChangeEmail ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setSettingsMode("change")}
          >
            {t("mail.notificationMailbox.changeEmailAction")}
          </Button>
        ) : null}
        {actions.showCompleteVerification ? (
          <Button type="button" size="sm" onClick={openOtpModal}>
            {completeActionLabel}
          </Button>
        ) : null}
        {actions.showResendVerification ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={resendBusy || resendCooldownSeconds > 0}
            onClick={() => void handleResendVerification()}
          >
            {formatVerificationResendActionLabel(t, resendCooldownSeconds)}
          </Button>
        ) : null}
        {actions.showCancelPending ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={lifecycleBusy}
            onClick={() => void handleCancelPending()}
          >
            {cancelActionLabel}
          </Button>
        ) : null}
        {actions.showDisable ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={lifecycleBusy}
            onClick={() => setDisableConfirmOpen(true)}
          >
            {t("mail.notificationMailbox.disableAction")}
          </Button>
        ) : null}
      </div>

      <NotificationIdentitySettingsModal
        open={settingsMode != null}
        targetUserId={targetUserId}
        targetUserName={targetUserName}
        targetUserEmail={targetUserEmail}
        mode={settingsMode ?? "configure"}
        onClose={() => setSettingsMode(null)}
        onSaved={() => {
          setActionMessage(t("mail.adminCenter.notificationIdentity.createSuccess"));
          notifyUpdated();
          if (settingsMode === "configure" || settingsMode === "change") {
            setOtpOpen(true);
          }
        }}
      />

      <NotificationIdentityOtpModal
        open={otpOpen}
        targetUserId={targetUserId}
        pending={state.pending}
        replacementPending={actions.isReplacementPending}
        onClose={() => setOtpOpen(false)}
        onVerified={() => {
          setActionMessage(
            actions.isReplacementPending
              ? t("mail.notificationMailbox.replacementSuccess")
              : t("mail.adminCenter.notificationIdentity.verifySuccess"),
          );
          notifyUpdated();
        }}
        onPendingUpdated={() => notifyUpdated()}
      />

      <NotificationIdentityDisableConfirmModal
        open={disableConfirmOpen}
        busy={lifecycleBusy}
        onClose={() => setDisableConfirmOpen(false)}
        onConfirm={() => void handleDisableConfirmed()}
      />
    </div>
  );
}

export function NotificationIdentityTeamMemberSelector({
  members,
  selectedUserId,
  onChange,
}: {
  members: Array<{ userId: string; name: string; email: string }>;
  selectedUserId: string | null;
  onChange: (userId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <Label htmlFor="notification-team-member">
        {t("mail.notificationMailbox.teamMemberLabel")}
      </Label>
      <select
        id="notification-team-member"
        className="surface-input mt-1 w-full max-w-md"
        value={selectedUserId ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.name}
          </option>
        ))}
      </select>
    </div>
  );
}
