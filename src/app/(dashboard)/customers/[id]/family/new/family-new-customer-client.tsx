"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, Label, Select } from "@/components/ui/form";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { useTranslation } from "@/i18n/provider";
import type { CustomerTagOption } from "@/lib/customer-tags/types";
import { NewCustomerForm } from "@/app/(dashboard)/customers/new/new-customer-form";
import { HOUSEHOLD_RELATIONSHIP_TYPES } from "../../../../../../../drizzle/schema/household-relationship-types";

type Props = {
  sourceCustomerId: string;
  sourceCustomerName: string;
  userId: string;
  tags: CustomerTagOption[];
};

export function FamilyNewCustomerClient({
  sourceCustomerId,
  sourceCustomerName,
  userId,
  tags,
}: Props) {
  const { t } = useCustomerLabels();
  const { t: tRoot } = useTranslation();
  const [relationshipType, setRelationshipType] = useState("");
  const [relationshipError, setRelationshipError] = useState<string | null>(
    null,
  );

  const relationshipOptions = HOUSEHOLD_RELATIONSHIP_TYPES.map((value) => ({
    value,
    label: t(`householdRelationships.${value}`),
  }));

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/customers/${sourceCustomerId}`}
          className="text-sm crm-text-secondary hover:underline"
        >
          {tRoot("customers.familyCreateBackToDetail")}
        </Link>
        <h2 className="page-title mt-2 text-2xl sm:text-3xl">
          {tRoot("customers.familyCreatePageTitle")}
        </h2>
      </div>

      <div className="surface-card mb-6 p-5 sm:p-6">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="crm-text-secondary">{tRoot("customers.familyReviewCurrent")}</dt>
            <dd className="mt-0.5 crm-text">{sourceCustomerName}</dd>
          </div>
          <Field>
            <Label htmlFor="family-create-relationship">
              {tRoot("customers.familyRelationshipLabel")}
            </Label>
            <Select
              id="family-create-relationship"
              value={relationshipType}
              onChange={(event) => {
                setRelationshipType(event.target.value);
                setRelationshipError(null);
              }}
            >
              <option value="">{tRoot("customers.familyRelationshipPlaceholder")}</option>
              {relationshipOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {relationshipError ? (
              <p className="mt-1 text-sm text-red-600" role="alert">
                {relationshipError}
              </p>
            ) : null}
          </Field>
        </dl>
      </div>

      <NewCustomerForm
        key={sourceCustomerId}
        tags={tags}
        userId={userId}
        familyContext={{
          sourceCustomerId,
          relationshipType,
          onRequireRelationship: () => {
            setRelationshipError(tRoot("customers.familyRelationshipRequired"));
            return false;
          },
        }}
      />
    </div>
  );
}
