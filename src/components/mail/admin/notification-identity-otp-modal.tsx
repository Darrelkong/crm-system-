"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import {
  sendTargetNotificationVerificationChallenge,
  verifyNotificationIdentity,
} from "@/lib/mail/client/api";
import type { NotificationIdentityApiItem } from "@/lib/mail/client/notification-identity-management";
import {
  VERIFICATION_CODE_INPUT_PROPS,
  computePendingVerificationResendCooldownSeconds,
  formatVerificationResendActionLabel,
  normalizeVerificationCodeFieldValue,
  parseNotificationVerificationErrorMetadata,
  resolveNotificationVerificationErrorMessage,
} from "@/lib/mail/client/notification-verification-client";

export function NotificationIdentityOtpModal({
  open,
  targetUserId,
  pending,
  replacementPending = false,
  onClose,
  onVerified,
  onPendingUpdated,
}: {
  open: boolean;
  targetUserId: string;
  pending: NotificationIdentityApiItem | null;
  replacementPending?: boolean;
  onClose: () => void;
  onVerified: () => void;
  onPendingUpdated: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [verifyCodeInput, setVerifyCodeInput] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [resendTick, setResendTick] = useState(0);

  const resendCooldownSeconds = useMemo(() => {
    void resendTick;
    return computePendingVerificationResendCooldownSeconds(
      pending?.verificationRequestedAt ?? null,
    );
  }, [pending?.verificationRequestedAt, resendTick]);

  useEffect(() => {
    if (!open) {
      setVerifyCodeInput("");
      setFeedback(null);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !pending?.verificationRequestedAt) {
      return;
    }
    if (resendCooldownSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setResendTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, pending?.verificationRequestedAt, resendCooldownSeconds]);

  if (!open || !pending) {
    return null;
  }

  function resolveFeedback(
    metadata?: Record<string, unknown>,
    fallback?: string,
  ): string {
    const localized = resolveNotificationVerificationErrorMessage(
      t,
      parseNotificationVerificationErrorMetadata(metadata),
    );
    return localized ?? fallback ?? t("common.networkError");
  }

  async function handleSendVerification() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await sendTargetNotificationVerificationChallenge(targetUserId);
      if (!result.ok) {
        setFeedback(resolveFeedback(result.metadata, result.error));
        return;
      }
      if (result.delivery.status === "transport_disabled") {
        setFeedback(t("mail.adminCenter.access.targetNotification.transportDisabled"));
      } else if (result.delivery.status === "delivery_failed") {
        setFeedback(t("mail.adminCenter.access.targetNotification.deliveryFailed"));
      } else if (result.delivery.status === "queued") {
        setFeedback(t("mail.adminCenter.notificationIdentity.verifySentInitial"));
      } else {
        setFeedback(t("mail.adminCenter.notificationIdentity.verifyResentSuccess"));
      }
      setResendTick((value) => value + 1);
      onPendingUpdated();
    } catch {
      setFeedback(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    if (!verifyCodeInput.trim()) return;

    setBusy(true);
    setFeedback(null);
    try {
      const pendingIdentity = pending;
      if (!pendingIdentity) return;

      const result = await verifyNotificationIdentity(
        pendingIdentity.id,
        normalizeVerificationCodeFieldValue(verifyCodeInput),
      );
      if (!result.ok) {
        setFeedback(resolveFeedback(result.metadata, result.error));
        onPendingUpdated();
        return;
      }
      setFeedback(t("mail.adminCenter.notificationIdentity.verifySuccess"));
      onVerified();
      onClose();
    } catch {
      setFeedback(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="overflow-hidden p-0">
        <div className="modal-panel-body p-4 sm:p-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold crm-text">
                {replacementPending
                  ? t("mail.notificationMailbox.otpModalReplacementTitle")
                  : t("mail.notificationMailbox.otpModalTitle")}
              </h3>
              <p className="text-sm crm-text-secondary">
                {replacementPending
                  ? t("mail.notificationMailbox.otpModalReplacementBody")
                  : t("mail.notificationMailbox.otpModalSentTo")}
              </p>
              <p className="break-all text-sm font-medium crm-text">
                {pending.email}
              </p>
              <p className="text-xs crm-text-secondary">
                {t("mail.notificationMailbox.otpModalValidity")}
              </p>
            </div>

            {feedback ? (
              <p className="break-words text-sm crm-text-secondary" role="status">
                {feedback}
              </p>
            ) : null}

            <form className="space-y-3" onSubmit={(event) => void handleVerify(event)}>
              <div>
                <Label htmlFor="notification-otp-code">
                  {t("mail.adminCenter.notificationIdentity.verifyCodeLabel")}
                </Label>
                <Input
                  id="notification-otp-code"
                  type="text"
                  value={verifyCodeInput}
                  onChange={(event) =>
                    setVerifyCodeInput(
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
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    busy ||
                    verifyCodeInput.length !== VERIFICATION_CODE_INPUT_PROPS.maxLength
                  }
                >
                  {replacementPending
                    ? t("mail.notificationMailbox.otpModalReplacementVerifyAction")
                    : t("mail.notificationMailbox.otpModalVerifyAction")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || resendCooldownSeconds > 0}
                  onClick={() => void handleSendVerification()}
                >
                  {formatVerificationResendActionLabel(t, resendCooldownSeconds)}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={onClose}>
                  {t("common.close")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
