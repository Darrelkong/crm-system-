"use client";

import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import type { IncompleteContactKind } from "@/lib/customers/incomplete-contact";

export function IncompleteContactConfirmModal({
  open,
  kind,
  onBack,
  onContinue,
}: {
  open: boolean;
  kind: IncompleteContactKind | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();

  if (!open || !kind) {
    return null;
  }

  const titleKey =
    kind === "wechat"
      ? "customers.incompleteWechatTitle"
      : "customers.incompletePhoneTitle";
  const descriptionKey =
    kind === "wechat"
      ? "customers.incompleteWechatDescription"
      : "customers.incompletePhoneDescription";

  return (
    <ModalOverlay onClose={onBack}>
      <ModalPanel className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <h3
          id="incomplete-contact-confirm-title"
          className="text-lg font-semibold text-[#172033]"
        >
          {t(titleKey)}
        </h3>
        <p
          id="incomplete-contact-confirm-description"
          className="mt-2 text-sm leading-relaxed text-[#6B7890]"
        >
          {t(descriptionKey)}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onBack}>
            {t("customers.incompleteContactBack")}
          </Button>
          <Button type="button" onClick={onContinue}>
            {t("customers.incompleteContactContinue")}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
