"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import type { RecycleBinCustomerView } from "@/lib/recycle-bin/types";
import { formatHongKongDateTime } from "@/lib/timezone";

type Props = {
  customer: RecycleBinCustomerView;
  onClose: () => void;
  onRestored: () => void;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_1fr] sm:gap-3">
      <dt className="text-[#6B7890]">{label}</dt>
      <dd className="font-medium text-[#172033]">{value}</dd>
    </div>
  );
}

export function RestoreCustomerModal({
  customer,
  onClose,
  onRestored,
}: Props) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirmRestore() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/recycle-bin/${customer.id}/restore`,
        { method: "POST" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? t("recycleBin.restoreFailed"));
        return;
      }
      onRestored();
      onClose();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <h3 className="text-lg font-medium text-[#172033]">
          {t("recycleBin.restoreModalTitle")}
        </h3>

        <div className="mt-4 space-y-5 text-sm text-[#172033]">
          <p className="text-[#6B7890]">{t("recycleBin.restoreModalIntro")}</p>

          <dl className="grid gap-2 rounded-xl bg-[#F7FAFD] p-4">
            <DetailRow
              label={t("recycleBin.colCustomerName")}
              value={customer.customer_name}
            />
            <DetailRow
              label={t("recycleBin.colCustomerCode")}
              value={customer.customer_code ?? "—"}
            />
            <DetailRow
              label={t("recycleBin.colOwner")}
              value={customer.owner_name ?? t("recycleBin.noOwner")}
            />
            <DetailRow
              label={t("recycleBin.colDeletedAt")}
              value={formatHongKongDateTime(customer.deleted_at)}
            />
            <DetailRow
              label={t("recycleBin.colDeletedReason")}
              value={customer.deleted_reason ?? "—"}
            />
          </dl>

          <div>
            <p className="font-medium">{t("recycleBin.restoreModalAfterTitle")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[#6B7890]">
              <li>{t("recycleBin.restoreModalReturnToList")}</li>
              <li>{t("recycleBin.restoreModalKeepAssignees")}</li>
              <li>{t("recycleBin.restoreModalKeepTimeline")}</li>
            </ul>
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleConfirmRestore()}
              disabled={submitting}
            >
              {submitting
                ? t("common.loading")
                : t("recycleBin.restoreModalConfirm")}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
