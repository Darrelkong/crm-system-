"use client";

import Link from "next/link";
import { ChevronRight, LockKeyhole, Plus } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import type { CustomerFamilyDetailSummary } from "@/lib/customers/households/detail-summary";
import { Button } from "@/components/ui/button";

type Props = {
  currentCustomerName: string;
  summary: CustomerFamilyDetailSummary | null;
  canManage: boolean;
  onAddFamilyMember?: () => void;
};

function relationshipLabelKey(
  relationshipType: NonNullable<
    CustomerFamilyDetailSummary["members"][number]["relationshipType"]
  >,
): string {
  return `householdRelationships.${relationshipType}`;
}

export function CustomerFamilySection({
  currentCustomerName,
  summary,
  canManage,
  onAddFamilyMember,
}: Props) {
  const { t } = useTranslation();
  const hasMembers = summary != null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium crm-text">{t("customers.familyMembers")}</h4>
        {canManage && onAddFamilyMember && (
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-sm"
            onClick={onAddFamilyMember}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("customers.addFamilyMember")}
          </Button>
        )}
      </div>

      {!hasMembers && canManage ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm crm-text-secondary">{t("customers.familyEmptyState")}</p>
          <p className="text-xs crm-text-muted">{t("customers.familyEmptyStateHint")}</p>
        </div>
      ) : null}

      {hasMembers ? (
        <ul className="mt-3 divide-y divide-[var(--crm-border)]">
          <li className="flex min-w-0 items-start justify-between gap-3 py-3 first:pt-0">
            <div className="min-w-0">
              <p className="truncate text-sm crm-text">{currentCustomerName}</p>
              <p className="mt-0.5 text-xs crm-text-secondary">
                {t("customers.familySelf")}
              </p>
            </div>
          </li>

          {summary.members.map((member) => (
            <li key={member.customerId} className="py-3">
              <Link
                href={`/customers/${member.customerId}`}
                className="group flex min-w-0 items-center justify-between gap-3 rounded-md -mx-1 px-1 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm crm-text group-hover:underline">
                    {member.customerName}
                  </p>
                  <p className="mt-0.5 text-xs crm-text-secondary">
                    {member.relationshipType
                      ? t(relationshipLabelKey(member.relationshipType))
                      : t("customers.familyMember")}
                  </p>
                </div>
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 crm-text-muted"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}

          {summary.hasProtectedMembers && (
            <li className="flex min-w-0 items-start gap-2.5 py-3">
              <LockKeyhole
                className="mt-0.5 h-3.5 w-3.5 shrink-0 crm-text-muted"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm crm-text-secondary">
                  {t("customers.familyProtectedMember")}
                </p>
                <p className="mt-0.5 text-xs crm-text-muted">
                  {t("customers.familyProtectedAccess")}
                </p>
              </div>
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
