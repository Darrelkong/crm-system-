"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError } from "@/i18n/resolve-api-error";

type Props = {
  customerId: string;
  targetCustomerId: string;
  targetCustomerName: string;
  open: boolean;
  onClose: () => void;
};

export function CustomerFamilyUnlinkModal({
  customerId,
  targetCustomerId,
  targetCustomerName,
  open,
  onClose,
}: Props) {
  const router = useRouter();
  const { t } = useCustomerLabels();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setError(null);
    setSuccessMessage(null);
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/customers/${customerId}/family/members/${targetCustomerId}/unlink`,
        { method: "POST" },
      );
      const data = (await response.json()) as {
        error?: string;
        errorCode?: string;
        mode?: string;
      };

      if (!response.ok) {
        setError(resolveApiError(t, data));
        return;
      }

      if (data.mode === "approval") {
        setSuccessMessage(t("customers.familySubmittedForApproval"));
        return;
      }

      router.refresh();
      onClose();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel>
        <h3 className="text-lg font-semibold crm-text">
          {t("customers.familyUnlinkTitle")}
        </h3>
        <div className="mt-3 space-y-2 text-sm crm-text-secondary">
          <p>{t("customers.familyUnlinkBody", { name: targetCustomerName })}</p>
          <p>{t("customers.familyUnlinkNoDelete")}</p>
          <p>{t("customers.familyUnlinkRelationshipNote")}</p>
          <p>{t("customers.familyUnlinkDissolveNote")}</p>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {successMessage ? (
          <p className="mt-3 text-sm text-emerald-700">{successMessage}</p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          {!successMessage ? (
            <Button
              type="button"
              variant="danger"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? t("common.saving") : t("customers.familyUnlinkAction")}
            </Button>
          ) : null}
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
