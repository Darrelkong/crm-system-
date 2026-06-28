"use client";

import { useTranslation } from "@/i18n/provider";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import {
  displayOrDash,
  formatPhoneForDisplay,
  parseOnHoldCreateApprovalPayload,
} from "@/lib/customers/on-hold-create-pending";

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

export function CreateOnHoldCustomerApprovalDetail({ reason, payload }: Props) {
  const { t } = useTranslation();
  const { approvalType, salesStage, customerType, source } = useCustomerLabels();
  const data = parseOnHoldCreateApprovalPayload(payload);
  const onHoldReason =
    data.onHoldReason?.trim() || reason.trim() || "—";
  const targetStage = data.targetSalesStage || data.requestedSalesStage || "on_hold";

  return (
    <dl className="mt-4 space-y-2 rounded-lg border border-[#E8EDF2] bg-[#F8FAFC] p-4 text-sm">
      <DetailRow
        label={t("approvals.type")}
        value={approvalType("create_on_hold_customer")}
      />
      <DetailRow
        label={t("approvals.onHoldCreateReason")}
        value={onHoldReason}
      />
      <DetailRow
        label={t("approvals.onHoldCreateTargetStage")}
        value={salesStage(targetStage)}
      />
      <DetailRow
        label={t("customers.clientName")}
        value={displayOrDash(data.customerName)}
      />
      <DetailRow
        label={t("customers.clientType")}
        value={data.customerType ? customerType(data.customerType) : "—"}
      />
      <DetailRow
        label={t("customers.phone")}
        value={formatPhoneForDisplay(data.phoneCountryCode, data.phone)}
      />
      <DetailRow
        label={t("customers.wechatId")}
        value={displayOrDash(data.wechatId)}
      />
      <DetailRow
        label={t("customers.email")}
        value={displayOrDash(data.email)}
      />
      <DetailRow
        label={t("customers.source")}
        value={data.source ? source(data.source) : "—"}
      />
      <DetailRow
        label={t("customers.requestedProjectName")}
        value={displayOrDash(data.requestedProjectName)}
      />
      <DetailRow
        label={t("customers.stageNotes")}
        value={displayOrDash(data.notes)}
      />
    </dl>
  );
}
