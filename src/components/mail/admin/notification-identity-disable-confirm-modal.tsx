"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import {
  scheduleDisableConfirmArm,
  shouldAllowDisableConfirmAction,
} from "@/lib/mail/client/notification-identity-disable-confirm-behavior";

export function NotificationIdentityDisableConfirmModal({
  open,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [confirmArmed, setConfirmArmed] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmArmed(false);
      return;
    }

    return scheduleDisableConfirmArm(() => {
      setConfirmArmed(true);
    });
  }, [open]);

  if (!open) {
    return null;
  }

  const canConfirm = shouldAllowDisableConfirmAction({
    armed: confirmArmed,
    busy,
  });

  function handleConfirm() {
    if (!canConfirm) {
      return;
    }
    onConfirm();
  }

  return (
    <ModalOverlay onClose={busy ? undefined : onClose}>
      <ModalPanel className="overflow-hidden p-0">
        <div
          className="modal-panel-body space-y-4 p-4 sm:p-6"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="space-y-2">
            <h3 className="text-lg font-semibold crm-text">
              {t("mail.notificationMailbox.disableConfirmTitle")}
            </h3>
            <p className="text-sm crm-text-secondary">
              {t("mail.notificationMailbox.disableConfirmBody")}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={!canConfirm}
              onClick={handleConfirm}
            >
              {t("mail.notificationMailbox.disableAction")}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
