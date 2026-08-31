"use client";

import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";

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

  if (!open) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="overflow-hidden p-0">
        <div className="modal-panel-body space-y-4 p-4 sm:p-6">
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
              disabled={busy}
              onClick={onConfirm}
            >
              {t("mail.notificationMailbox.disableAction")}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
