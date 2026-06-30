"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";

const COUNTDOWN_SECONDS = 5;

export type CreateCustomerConfirmData = {
  customerName: string;
  requestedProjectName: string;
  phoneCountryCode: string;
  phone: string;
  wechatId: string;
  email: string;
};

function displayValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8.5rem_1fr] sm:gap-4">
      <dt className="text-sm text-[#6B7890]">{label}</dt>
      <dd className="text-base font-semibold text-[#172033]">{value}</dd>
    </div>
  );
}

export function CreateCustomerConfirmModal({
  open,
  submitting,
  data,
  onBack,
  onConfirm,
}: {
  open: boolean;
  submitting: boolean;
  data: CreateCustomerConfirmData;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (!open) {
      return;
    }

    setCountdown(COUNTDOWN_SECONDS);
    const timer = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [open]);

  if (!open) {
    return null;
  }

  const canConfirm = countdown === 0 && !submitting;
  const phoneDisplay = [data.phoneCountryCode, data.phone]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");

  return (
    <ModalOverlay onClose={submitting ? undefined : onBack}>
      <ModalPanel className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <h3
          id="create-customer-confirm-title"
          className="text-lg font-semibold text-[#172033]"
        >
          {t("customers.createConfirmTitle")}
        </h3>
        <p
          id="create-customer-confirm-description"
          className="mt-2 text-sm leading-relaxed text-[#6B7890]"
        >
          {t("customers.createConfirmDescription")}
        </p>

        <dl className="mt-5 space-y-4 rounded-xl bg-[#F7FAFD] p-4">
          <ConfirmRow
            label={t("customers.confirmCustomerName")}
            value={displayValue(data.customerName)}
          />
          <ConfirmRow
            label={t("customers.confirmRequestedProjectName")}
            value={displayValue(data.requestedProjectName)}
          />
          <ConfirmRow
            label={t("customers.confirmPhone")}
            value={displayValue(phoneDisplay)}
          />
          <ConfirmRow
            label={t("customers.confirmWechat")}
            value={displayValue(data.wechatId)}
          />
          <ConfirmRow
            label={t("customers.confirmEmail")}
            value={displayValue(data.email)}
          />
        </dl>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {countdown > 0 && (
            <p className="text-sm text-[#6B7890] sm:mr-auto">
              {t("customers.createConfirmWait", { seconds: String(countdown) })}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={onBack}
              disabled={submitting}
            >
              {t("customers.createConfirmBack")}
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm}
            >
              {submitting
                ? t("customers.saving")
                : t("customers.createConfirmSubmit")}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
