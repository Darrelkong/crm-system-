"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { Input, Label, Field } from "@/components/ui/form";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError, resolveFieldError } from "@/i18n/resolve-api-error";

export function ReleaseToPoolButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { t } = useCustomerLabels();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRelease() {
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/customers/${customerId}/release-to-pool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        errorCode?: string;
        fieldErrors?: { field: string; message: string; code?: string }[];
      };

      if (res.ok) {
        router.push(`/customers/${customerId}`);
        router.refresh();
        return;
      }

      if (data.fieldErrors?.length) {
        setError(
          data.fieldErrors
            .map((e) => resolveFieldError(t, e))
            .join(" · "),
        );
        return;
      }

      setError(resolveApiError(t, data));
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
      >
        {t("customers.releaseToPool")}
      </button>
    );
  }

  return (
    <ModalOverlay
      onClose={() => {
        setOpen(false);
        setReason("");
        setConfirmed(false);
        setError(null);
      }}
    >
      <ModalPanel>
        <h3 className="text-lg font-semibold text-[#172033]">
          {t("customers.releaseConfirmTitle")}
        </h3>
        <p className="mt-2 text-sm text-amber-700">{t("customers.releaseConfirmBody")}</p>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4">
          <Field>
            <Label htmlFor="pool-reason">
              {t("customers.releaseReason")} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="pool-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("customers.releaseReasonPlaceholder")}
            />
          </Field>

          <label className="mt-3 flex items-start gap-2 text-sm text-[#172033]">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span>{t("customers.releaseConfirmCheckbox")}</span>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setOpen(false);
              setReason("");
              setConfirmed(false);
              setError(null);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!confirmed || !reason.trim() || submitting}
            onClick={handleRelease}
          >
            {submitting ? t("customers.releasing") : t("customers.confirmRelease")}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
