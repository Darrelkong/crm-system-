"use client";

import { CustomerNameLabel } from "@/components/customers/customer-name-label";
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
  /** Customer row nameStatus from the authorized approval DTO. */
  nameStatus?: string | null;
  /** Server-resolved source label (Phase 1 resolver). */
  sourceDisplayLabel?: string | null;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#6B7890]">{label}</dt>
      <dd className="whitespace-pre-wrap text-[#172033]">{value}</dd>
    </div>
  );
}

export function CreateOnHoldCustomerApprovalDetail({
  reason,
  payload,
  nameStatus,
  sourceDisplayLabel,
}: Props) {
  const { t, locale } = useTranslation();
  const { approvalType, salesStage, customerType } = useCustomerLabels();
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
      <div>
        <dt className="text-[#6B7890]">{t("customers.clientName")}</dt>
        <dd className="text-[#172033]">
          {data.customerName ? (
            <CustomerNameLabel
              customerName={data.customerName}
              nameStatus={nameStatus}
              locale={locale}
              pendingLabel={t("customers.namePendingBadge")}
            />
          ) : (
            "—"
          )}
        </dd>
      </div>
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
        value={
          data.source
            ? (sourceDisplayLabel ?? data.source)
            : "—"
        }
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
