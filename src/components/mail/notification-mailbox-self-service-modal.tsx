"use client";

import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import { NotificationIdentityControlView } from "./admin/notification-identity-control-view";

export function NotificationMailboxSelfServiceModal({
  open,
  onClose,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const { t } = useTranslation();
  const { session } = useMailSession();
  const user = session?.user;

  if (!open || !user) {
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
                {t("mail.notificationMailbox.description")}
              </p>
            </div>
            <NotificationIdentityControlView
              targetUserId={user.id}
              targetUserName={user.name}
              targetUserEmail={user.email}
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
