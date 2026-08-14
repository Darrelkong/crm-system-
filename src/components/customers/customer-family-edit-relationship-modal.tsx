"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Label, Select } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { HOUSEHOLD_RELATIONSHIP_TYPES } from "../../../drizzle/schema/household-relationship-types";
import type { CustomerFamilyMemberRelationship } from "@/lib/customers/households/detail-summary";

type Props = {
  customerId: string;
  currentCustomerName: string;
  targetCustomerId: string;
  targetCustomerName: string;
  currentRelationship: CustomerFamilyMemberRelationship | null;
  open: boolean;
  onClose: () => void;
};

export function CustomerFamilyEditRelationshipModal({
  customerId,
  currentCustomerName,
  targetCustomerId,
  targetCustomerName,
  currentRelationship,
  open,
  onClose,
}: Props) {
  const router = useRouter();
  const { t } = useCustomerLabels();
  const [relationshipType, setRelationshipType] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const relationshipOptions = useMemo(
    () =>
      HOUSEHOLD_RELATIONSHIP_TYPES.map((value) => ({
        value,
        label: t(`householdRelationships.${value}`),
      })),
    [t],
  );

  const reset = useCallback(() => {
    setRelationshipType("");
    setError(null);
    setSuccessMessage(null);
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  const currentLabel = currentRelationship
    ? currentRelationship === "parent"
      ? t("customers.familyRelationshipParentDisplay")
      : t(`householdRelationships.${currentRelationship}`)
    : t("customers.familyMember");

  const title = currentRelationship
    ? t("customers.familyEditRelationship")
    : t("customers.familySetRelationship");

  async function handleSubmit() {
    if (!relationshipType) {
      setError(t("customers.familyRelationshipRequired"));
      return;
    }

    if (
      currentRelationship &&
      currentRelationship !== "parent" &&
      relationshipType === currentRelationship
    ) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/customers/${customerId}/family/members/${targetCustomerId}/relationship`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relationshipType }),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        errorCode?: string;
        mode?: string;
        kind?: string;
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
        <h3 className="text-lg font-semibold crm-text">{title}</h3>
        <p className="mt-2 text-sm crm-text-secondary">
          {currentCustomerName}
          <span className="mx-2 crm-text-muted">{t("customers.familyWithConnector")}</span>
          {targetCustomerName}
        </p>

        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="crm-text-secondary">{t("customers.familyCurrentRelationship")}</dt>
            <dd className="mt-1 crm-text">{currentLabel}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <Field>
            <Label htmlFor="family-edit-relationship">
              {t("customers.familyNewRelationship")}
            </Label>
            <Select
              id="family-edit-relationship"
              value={relationshipType}
              onChange={(event) => setRelationshipType(event.target.value)}
            >
              <option value="">{t("customers.familyRelationshipPlaceholder")}</option>
              {relationshipOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
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
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting ? t("common.saving") : t("common.confirm")}
            </Button>
          ) : null}
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
