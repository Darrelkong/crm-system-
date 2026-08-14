"use client";

import { useCustomerLabels } from "@/i18n/use-customer-labels";

type Props = {
  reason: string;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#6B7890]">{label}</dt>
      <dd className="whitespace-pre-wrap text-[#172033]">{value}</dd>
    </div>
  );
}

export function PriorityCustomerApprovalDetail({ reason }: Props) {
  const { t } = useCustomerLabels();

  return (
    <dl className="mt-4 space-y-2 rounded-lg border border-[#E8EDF2] bg-[#F8FAFC] p-4 text-sm">
      <DetailRow label={t("approvals.reason")} value={reason} />
    </dl>
  );
}
