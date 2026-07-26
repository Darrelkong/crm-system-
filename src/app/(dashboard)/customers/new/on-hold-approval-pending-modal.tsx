"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Label, Textarea } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import { ON_HOLD_REASON_MIN_LENGTH } from "@/lib/customers/on-hold-create-pending";

export function OnHoldReasonModal({
  open,
  submitting,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (onHoldReason: string) => void;
}) {
  const { t } = useTranslation();
  const [onHoldReason, setOnHoldReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  function handleSubmit() {
    const trimmed = onHoldReason.trim();
    if (trimmed.length < ON_HOLD_REASON_MIN_LENGTH) {
      setError(t("customers.onHoldReasonTooShort"));
      return;
    }
    setError(null);
    onSubmit(trimmed);
  }

  function handleCancel() {
    setOnHoldReason("");
    setError(null);
    onCancel();
  }

  return (
    <ModalOverlay onClose={submitting ? undefined : handleCancel}>
      <ModalPanel className="max-w-md rounded-3xl border border-red-100 shadow-2xl sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <CircleAlert
              className="h-7 w-7 text-red-600"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>

          <h2
            id="on-hold-reason-title"
            className="mt-5 text-2xl font-semibold tracking-tight text-[#172033] sm:text-[1.75rem]"
          >
            {t("customers.onHoldReasonModalTitle")}
          </h2>

          <p
            id="on-hold-reason-description"
            className="mt-4 text-left text-base leading-relaxed text-[#3D4A5C]"
          >
            {t("customers.onHoldReasonModalDescription")}
          </p>
        </div>

        <div className="mt-6 text-left">
          <Field>
            <Label htmlFor="on-hold-reason">{t("customers.onHoldReasonLabel")}</Label>
            <Textarea
              id="on-hold-reason"
              rows={4}
              value={onHoldReason}
              onChange={(e) => {
                setOnHoldReason(e.target.value);
                if (error) setError(null);
              }}
              placeholder={t("customers.onHoldReasonPlaceholder")}
              disabled={submitting}
            />
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </Field>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancel}
            disabled={submitting}
          >
            {t("customers.onHoldReasonCancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting
              ? t("customers.saving")
              : t("customers.onHoldReasonSubmit")}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}

export function OnHoldApprovalSubmittedModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  if (!open) {
    return null;
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="max-w-md rounded-3xl border border-red-100 shadow-2xl sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <CircleAlert
              className="h-7 w-7 text-red-600"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>

          <h2
            id="on-hold-approval-submitted-title"
            className="mt-5 text-2xl font-semibold tracking-tight text-[#172033] sm:text-[1.75rem]"
          >
            {t("customers.onHoldApprovalSubmittedTitle")}
          </h2>

          <p
            id="on-hold-approval-submitted-message"
            className="mt-4 text-lg font-medium leading-relaxed text-[#3D4A5C] sm:text-xl"
          >
            {t("customers.onHoldApprovalSubmittedMessage")}
          </p>

          <div className="mt-8">
            <Button type="button" onClick={onClose} className="min-w-[8rem]">
              {t("customers.onHoldApprovalSubmittedConfirm")}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
