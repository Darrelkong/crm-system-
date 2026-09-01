"use client";

import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import { NotificationIdentityControlView } from "./notification-identity-control-view";

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

  if (!open || !targetUserId) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="overflow-hidden p-0">
        <div className="modal-panel-body p-4 sm:p-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold crm-text">
                {t("mail.notificationMailbox.managementTitle")}
              </h3>
              <p className="text-sm crm-text-secondary">
                {t("mail.adminCenter.access.targetNotification.description")}
              </p>
            </div>
            <NotificationIdentityControlView
              targetUserId={targetUserId}
              targetUserName={targetUserName}
              targetUserEmail={targetUserEmail}
              allowSecurityRevoke
              onUpdated={onUpdated}
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm crm-text-secondary hover:crm-text"
                onClick={onClose}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
