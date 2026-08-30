"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import {
  issueSelfNotificationVerificationToken,
} from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  canIssueSelfVerificationToken,
  clearVerificationTokenModalPayload,
  findActivePendingNotificationIdentity,
  type NotificationIdentityApiItem,
  type VerificationTokenModalPayload,
} from "@/lib/mail/client/notification-identity-management";
import { formatHongKongDateTime } from "@/lib/timezone";

function NotificationIdentityProofTokenModal({
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
      <ModalPanel className="overflow-hidden p-0">
        <div className="modal-panel-body p-4 sm:p-6">
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

export function NotificationIdentityProofTools({
  pending,
  busy,
  onIssueToken,
}: {
  pending: NotificationIdentityApiItem | null;
  busy: boolean;
  onIssueToken: () => void;
}) {
  const { t } = useTranslation();

  if (!pending) {
    return null;
  }

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

export function NotificationIdentityProofDiagnosticsPanel({
  selfItems,
  onReload,
}: {
  selfItems: NotificationIdentityApiItem[];
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const canIssueToken = canIssueSelfVerificationToken(capabilities);
  const pending = findActivePendingNotificationIdentity(selfItems);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tokenModal, setTokenModal] = useState<VerificationTokenModalPayload | null>(
    null,
  );

  if (!canIssueToken) {
    return null;
  }

  async function handleIssueToken() {
    if (!pending) {
      setMessage(t("mail.adminCenter.proofDiagnostics.pendingIdentityRequired"));
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await issueSelfNotificationVerificationToken();
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setTokenModal({
        token: result.verificationToken,
        expiresAt: result.expiresAt,
      });
      onReload();
    } catch {
      setMessage(t("common.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {message ? (
        <p className="text-sm crm-text-secondary" role="status">
          {message}
        </p>
      ) : null}
      <NotificationIdentityProofTools
        pending={pending}
        busy={busy}
        onIssueToken={() => void handleIssueToken()}
      />
      {tokenModal ? (
        <NotificationIdentityProofTokenModal
          payload={tokenModal}
          onClose={() => setTokenModal(clearVerificationTokenModalPayload())}
        />
      ) : null}
    </div>
  );
}
