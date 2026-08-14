"use client";

import { useRouter } from "next/navigation";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import { Link2, UserPlus } from "lucide-react";

type Props = {
  customerId: string;
  open: boolean;
  onClose: () => void;
  onLinkExisting: () => void;
};

export function CustomerFamilyMemberChooserModal({
  customerId,
  open,
  onClose,
  onLinkExisting,
}: Props) {
  const router = useRouter();
  const { t } = useTranslation();

  if (!open) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="sm:max-w-md">
        <h3 className="text-lg font-semibold crm-text">
          {t("customers.addFamilyMember")}
        </h3>
        <p className="mt-1 text-sm crm-text-secondary">
          {t("customers.familyMemberChooserSubtitle")}
        </p>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-lg border border-[var(--crm-border)] p-4 text-left transition-colors hover:bg-[var(--crm-surface-muted)]"
            onClick={() => {
              onClose();
              onLinkExisting();
            }}
          >
            <Link2 className="mt-0.5 h-5 w-5 shrink-0 crm-text-secondary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium crm-text">
                {t("customers.familyLinkExistingAction")}
              </p>
              <p className="mt-1 text-xs crm-text-muted">
                {t("customers.familyLinkExistingDescription")}
              </p>
            </div>
          </button>

          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-lg border border-[var(--crm-border)] p-4 text-left transition-colors hover:bg-[var(--crm-surface-muted)]"
            onClick={() => {
              onClose();
              router.push(`/customers/${customerId}/family/new`);
            }}
          >
            <UserPlus className="mt-0.5 h-5 w-5 shrink-0 crm-text-secondary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium crm-text">
                {t("customers.familyCreateNewAction")}
              </p>
              <p className="mt-1 text-xs crm-text-muted">
                {t("customers.familyCreateNewDescription")}
              </p>
            </div>
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
