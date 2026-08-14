"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { useCustomerLabels } from "@/i18n/use-customer-labels";

const CustomerApprovalRequestsModal = dynamic(
  () =>
    import("./customer-approval-requests-modal").then(
      (mod) => mod.CustomerApprovalRequestsModal,
    ),
  { ssr: false },
);

type Props = {
  customerId: string;
  isPinned: boolean;
  salesStage: string;
  isAdmin: boolean;
  pendingPriorityApproval: boolean;
};

export function CustomerApprovalRequestsEntry({
  customerId,
  isPinned,
  salesStage,
  isAdmin,
  pendingPriorityApproval,
}: Props) {
  const { t } = useCustomerLabels();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("customers.submitApproval")}
      </Button>
    );
  }

  return (
    <CustomerApprovalRequestsModal
      customerId={customerId}
      isPinned={isPinned}
      salesStage={salesStage}
      isAdmin={isAdmin}
      pendingPriorityApproval={pendingPriorityApproval}
      onClose={() => setOpen(false)}
    />
  );
}
