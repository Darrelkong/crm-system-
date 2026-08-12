"use client";

import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { FamilyLinkAdminDetail } from "@/lib/approvals/family-link-serialization";

type Props = {
  isAdmin: boolean;
  sourceCustomerName: string;
  familyLinkAdminDetail?: FamilyLinkAdminDetail;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#6B7890]">{label}</dt>
      <dd className="whitespace-pre-wrap text-[#172033]">{value}</dd>
    </div>
  );
}

export function LinkFamilyCustomerApprovalDetail({
  isAdmin,
  sourceCustomerName,
  familyLinkAdminDetail,
}: Props) {
  const { t, approvalType } = useCustomerLabels();

  if (!isAdmin) {
    return (
      <dl className="mt-4 space-y-2 rounded-lg border border-[#E8EDF2] bg-[#F8FAFC] p-4 text-sm">
        <DetailRow
          label={t("approvals.type")}
          value={approvalType("link_family_customer")}
        />
        <DetailRow
          label={t("customers.familyReviewCurrent")}
          value={sourceCustomerName}
        />
      </dl>
    );
  }

  return (
    <dl className="mt-4 space-y-2 rounded-lg border border-[#E8EDF2] bg-[#F8FAFC] p-4 text-sm">
      <DetailRow
        label={t("approvals.type")}
        value={approvalType("link_family_customer")}
      />
      <DetailRow
        label={t("customers.familyReviewCurrent")}
        value={sourceCustomerName}
      />
      <DetailRow
        label={t("customers.familyReviewTarget")}
        value={familyLinkAdminDetail?.targetCustomerName ?? "—"}
      />
      <DetailRow
        label={t("customers.familyReviewRelationship")}
        value={
          familyLinkAdminDetail?.relationshipType
            ? t(`householdRelationships.${familyLinkAdminDetail.relationshipType}`)
            : "—"
        }
      />
    </dl>
  );
}
