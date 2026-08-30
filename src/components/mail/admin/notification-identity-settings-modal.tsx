"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import { createNotificationIdentity } from "@/lib/mail/client/api";

export function NotificationIdentitySettingsModal({
  open,
  targetUserId,
  targetUserName,
  targetUserEmail,
  mode,
  initialEmail = "",
  onClose,
  onSaved,
}: {
  open: boolean;
  targetUserId: string;
  targetUserName: string;
  targetUserEmail: string;
  mode: "configure" | "change";
  initialEmail?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail);
      setFeedback(null);
    }
  }, [open, initialEmail]);

  if (!open) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setBusy(true);
    setFeedback(null);
    try {
      const result = await createNotificationIdentity(targetUserId, email.trim());
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      onSaved();
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
            <div className="space-y-1">
              <h3 className="text-lg font-semibold crm-text">
                {t("mail.adminCenter.access.targetNotification.title")}
              </h3>
              <p className="text-sm crm-text-secondary">
                {mode === "change"
                  ? t("mail.notificationMailbox.changeEmailDescription")
                  : t("mail.adminCenter.access.targetNotification.description")}
              </p>
              <p className="text-sm font-medium crm-text">{targetUserName}</p>
              <p className="break-all text-sm crm-text-secondary">
                {targetUserEmail}
              </p>
            </div>

            {feedback ? (
              <p className="break-words text-sm crm-text-secondary" role="status">
                {feedback}
              </p>
            ) : null}

            <form className="space-y-3" onSubmit={(event) => void handleSubmit(event)}>
              <div>
                <Label htmlFor="notification-settings-email">
                  {t("mail.adminCenter.notificationIdentity.addEmailLabel")}
                </Label>
                <Input
                  id="notification-settings-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t(
                    "mail.adminCenter.notificationIdentity.addEmailPlaceholder",
                  )}
                  disabled={busy}
                  required
                  className="mt-1"
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={onClose}>
                  {t("common.close")}
                </Button>
                <Button type="submit" size="sm" disabled={busy || !email.trim()}>
                  {t("mail.adminCenter.access.targetNotification.addAction")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
