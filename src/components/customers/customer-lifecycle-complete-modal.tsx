"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { Textarea, Label, Field } from "@/components/ui/form";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError } from "@/i18n/resolve-api-error";

export function CustomerLifecycleCompleteModal({
  customerId,
}: {
  customerId: string;
}) {
  const router = useRouter();
  const { t, salesStage } = useCustomerLabels();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setOpen(false);
    setNotes("");
    setError(null);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/customers/${customerId}/lifecycle-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        errorCode?: string;
      };

      if (res.ok) {
        handleClose();
        router.refresh();
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
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
        {t("customers.lifecycleCompleteButton")}
      </Button>
    );
  }

  return (
    <ModalOverlay onClose={handleClose}>
      <ModalPanel>
        <h2 className="text-lg font-semibold text-gray-900">
          {t("customers.lifecycleCompleteTitle")}
        </h2>

        <div className="mt-4 space-y-3 text-sm text-gray-700">
          <p>
            <span className="font-medium">
              {t("customers.lifecycleCompleteCurrentLabel")}：
            </span>
            {salesStage("paid")}
          </p>
          <p>
            <span className="font-medium">
              {t("customers.lifecycleCompleteTargetLabel")}：
            </span>
            {t("customers.lifecycleCompleteTargetValue")}
          </p>
        </div>

        <div className="mt-4">
          <Field>
            <Label htmlFor="lifecycle-completion-notes">
              {t("customers.lifecycleCompleteNotes")}
            </Label>
            <Textarea
              id="lifecycle-completion-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("customers.lifecycleCompleteNotesPlaceholder")}
              rows={3}
            />
          </Field>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting
              ? t("customers.submitting")
              : t("customers.lifecycleCompleteConfirm")}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
