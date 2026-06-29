"use client";

import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { parseAssigneeUpdateApprovalPayload } from "@/lib/customers/assignees-validation";

type Props = {
  reason: string;
  payload: Record<string, unknown> | null;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#6B7890]">{label}</dt>
      <dd className="whitespace-pre-wrap text-[#172033]">{value}</dd>
    </div>
  );
}

function formatStaffNames(
  names: Array<{ id: string; name: string }> | undefined,
  fallback: string,
): string {
  if (!names || names.length === 0) {
    return fallback;
  }
  return names.map((row) => row.name).join("、");
}

export function UpdateCustomerAssigneesApprovalDetail({
  reason,
  payload,
}: Props) {
  const { t, approvalType } = useCustomerLabels();
  const data = parseAssigneeUpdateApprovalPayload(payload);
  const emptyLabel = t("customers.noCollaboratorsYet");

  if (!data) {
    return (
      <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {t("customers.assigneeApprovalInvalidPayload")}
      </div>
    );
  }

  return (
    <dl className="mt-4 space-y-2 rounded-lg border border-[#E8EDF2] bg-[#F8FAFC] p-4 text-sm">
      <DetailRow
        label={t("approvals.type")}
        value={approvalType("update_customer_assignees")}
      />
      <DetailRow
        label={t("approvals.reason")}
        value={data.reason?.trim() || reason.trim() || "—"}
      />
      <DetailRow
        label={t("customers.currentCollaborators")}
        value={formatStaffNames(data.currentCollaborators, emptyLabel)}
      />
      <DetailRow
        label={t("customers.requestedCollaborators")}
        value={formatStaffNames(data.requestedCollaborators, emptyLabel)}
      />
      <DetailRow
        label={t("customers.addedCollaborators")}
        value={formatStaffNames(data.addedCollaborators, "—")}
      />
      <DetailRow
        label={t("customers.removedCollaborators")}
        value={formatStaffNames(data.removedCollaborators, "—")}
      />
    </dl>
  );
}
