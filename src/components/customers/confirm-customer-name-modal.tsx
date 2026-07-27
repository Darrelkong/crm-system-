"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { Field, Input, Label } from "@/components/ui/form";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { isValidCustomerName } from "@/lib/customers/validation";
import {
  isPendingNamePlaceholder,
} from "@/lib/customers/name-status";
import {
  createConfirmCustomerNameSubmitFlight,
  postConfirmCustomerNameOnce,
} from "@/lib/customers/confirm-name-submit-flight";

function isForbiddenPlaceholderLabel(value: string): boolean {
  const trimmed = value.trim();
  if (isPendingNamePlaceholder(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower === "mr. x" ||
    lower === "ms. x" ||
    lower === "mr.x" ||
    lower === "ms.x"
  );
}

export function ConfirmCustomerNameModal({
  customerId,
}: {
  customerId: string;
}) {
  const router = useRouter();
  const { t } = useCustomerLabels();
  const flightRef = useRef(createConfirmCustomerNameSubmitFlight());
  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>();
  const [fieldError, setFieldError] = useState<string | null>(null);

  function handleClose() {
    if (submitting) return;
    setOpen(false);
    setCustomerName("");
    setError(null);
    setFieldError(null);
  }

  function validateLocal(): boolean {
    const trimmed = customerName.trim();
    if (!trimmed) {
      setFieldError(t("customers.confirmNameRequired"));
      return false;
    }
    if (isForbiddenPlaceholderLabel(trimmed) || !isValidCustomerName(trimmed)) {
      setFieldError(t("customers.confirmNameInvalid"));
      return false;
    }
    setFieldError(null);
    return true;
  }

  async function handleSubmit() {
    if (!validateLocal()) {
      return;
    }

    setError(null);

    const result = await postConfirmCustomerNameOnce({
      flight: flightRef.current,
      customerId,
      body: { customerName: customerName.trim() },
      onAcquired: () => setSubmitting(true),
    });

    if (result.status === "blocked") {
      return;
    }

    if (result.status === "network_error") {
      setSubmitting(false);
      setError(t("common.networkError"));
      return;
    }

    try {
      const data = (await result.response.json()) as {
        ok?: boolean;
        error?: string;
        errorCode?: string;
        customer?: {
          customerName?: string;
          nameStatus?: string;
        };
      };

      if (result.response.ok) {
        setOpen(false);
        setCustomerName("");
        setError(null);
        setFieldError(null);
        setSubmitting(false);
        router.refresh();
        return;
      }

      flightRef.current.release();
      setSubmitting(false);

      if (result.response.status === 409) {
        setError(t("customers.confirmNameConflict"));
        router.refresh();
        return;
      }

      setError(resolveApiError(t, data));
    } catch {
      flightRef.current.release();
      setSubmitting(false);
      setError(t("common.networkError"));
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
        {t("customers.confirmRealName")}
      </Button>
    );
  }

  return (
    <ModalOverlay onClose={handleClose}>
      <ModalPanel>
        <h2 className="text-lg font-semibold crm-text">
          {t("customers.confirmRealName")}
        </h2>

        <div className="mt-4">
          <Field>
            <Label htmlFor="confirm-real-customer-name">
              {t("customers.clientName")}{" "}
              <span className="text-red-500">*</span>
            </Label>
            <Input
              id="confirm-real-customer-name"
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                if (fieldError) setFieldError(null);
              }}
              placeholder={t("customers.confirmNamePlaceholder")}
              autoComplete="off"
              disabled={submitting}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
            />
            {fieldError && (
              <p className="mt-1 text-xs text-red-600">{fieldError}</p>
            )}
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
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {t("customers.confirmRealNameConfirm")}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
