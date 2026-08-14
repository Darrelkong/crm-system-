"use client";

import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { FamilyManagementAdminDetail } from "@/lib/approvals/family-link-serialization";

type Props = {
  isAdmin: boolean;
  sourceCustomerName: string;
  familyManagementAdminDetail?: FamilyManagementAdminDetail;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#6B7890]">{label}</dt>
      <dd className="whitespace-pre-wrap text-[#172033]">{value}</dd>
    </div>
  );
}

export function FamilyManagementApprovalDetail({
  isAdmin,
  sourceCustomerName,
  familyManagementAdminDetail,
}: Props) {
  const { t, approvalType } = useCustomerLabels();

  const requestType =
    familyManagementAdminDetail?.action === "unlink"
      ? "unlink_family_customer"
      : "update_family_relationship";

  if (!isAdmin) {
    return (
      <dl className="mt-4 space-y-2 rounded-lg border border-[#E8EDF2] bg-[#F8FAFC] p-4 text-sm">
        <DetailRow
          label={t("approvals.type")}
          value={approvalType(requestType)}
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
      <DetailRow label={t("approvals.type")} value={approvalType(requestType)} />
      <DetailRow
        label={t("customers.familyReviewCurrent")}
        value={sourceCustomerName}
      />
      <DetailRow
        label={t("customers.familyReviewTarget")}
        value={familyManagementAdminDetail?.targetCustomerName ?? "—"}
      />
      {familyManagementAdminDetail?.action === "unlink" ? (
        <DetailRow
          label={t("customers.familyReviewRequest")}
          value={t("customers.familyUnlinkAction")}
        />
      ) : (
        <>
          <DetailRow
            label={t("customers.familyCurrentRelationship")}
            value={
              familyManagementAdminDetail?.currentRelationship
                ? t(
                    `householdRelationships.${familyManagementAdminDetail.currentRelationship}`,
                  )
                : "—"
            }
          />
          <DetailRow
            label={t("customers.familyRequestedRelationship")}
            value={
              familyManagementAdminDetail?.requestedRelationship
                ? t(
                    `householdRelationships.${familyManagementAdminDetail.requestedRelationship}`,
                  )
                : "—"
            }
          />
        </>
      )}
    </dl>
  );
}
