"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { Input, Textarea, Label, Field, Select } from "@/components/ui/form";
import type { ApprovalRequestType } from "../../../drizzle/schema/approvals";
import { CUSTOMER_DETAIL_APPROVAL_REQUEST_TYPES } from "@/lib/approvals/errors";
import {
  buildPaidCustomerApprovalPayload,
  validatePaidCustomerFormClient,
} from "@/lib/approvals/paid-customer-payload";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError, resolveFieldError } from "@/i18n/resolve-api-error";
import { ui } from "@/lib/ui/classes";

type StaffUser = { id: string; displayName: string; email: string };

const REQUEST_TYPES: ApprovalRequestType[] = [
  ...CUSTOMER_DETAIL_APPROVAL_REQUEST_TYPES,
];

export function CustomerApprovalRequests({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { t, approvalType } = useCustomerLabels();
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState<ApprovalRequestType>("delete_customer");
  const [reason, setReason] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [serviceItems, setServiceItems] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [remarks, setRemarks] = useState("");
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/users/staff")
      .then((res) => res.json())
      .then((data: { items?: StaffUser[] }) => setStaffUsers(data.items ?? []))
      .catch(() => setStaffUsers([]));
  }, [open]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = {
      requestType,
      reason: reason.trim(),
    };

    if (requestType === "transfer_customer") {
      body.targetUserId = targetUserId;
    }

    if (requestType === "paid_customer") {
      const validation = validatePaidCustomerFormClient({
        serviceItems,
        paidAmount,
        paidAt,
        remarks,
      });
      if (!validation.ok) {
        setError(validation.errors.map((e) => e.message).join(" · "));
        setSubmitting(false);
        return;
      }
      body.payload = buildPaidCustomerApprovalPayload({
        serviceItems,
        paidAmount,
        paidAt,
        remarks,
      });
    }

    try {
      const res = await fetch(`/api/customers/${customerId}/approval-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        errorCode?: string;
        fieldErrors?: { field: string; message: string; code?: string }[];
      };

      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }

      if (data.fieldErrors?.length) {
        setError(data.fieldErrors.map((e) => resolveFieldError(t, e)).join(" · "));
        return;
      }

      setError(resolveApiError(t, data));
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("customers.submitApproval")}
      </Button>
    );
  }

  return (
    <ModalOverlay onClose={() => setOpen(false)}>
      <ModalPanel>
        <h3 className={ui.customerDetail.subsectionTitle}>
          {t("customers.submitApprovalTitle")}
        </h3>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4 space-y-4">
          <Field>
            <Label htmlFor="request-type">{t("customers.requestType")}</Label>
            <Select
              id="request-type"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as ApprovalRequestType)}
            >
              {REQUEST_TYPES.map((typeKey) => (
                <option key={typeKey} value={typeKey}>
                  {approvalType(typeKey)}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            <Label htmlFor="approval-reason">
              {t("customers.approvalReason")} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="approval-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("customers.approvalReasonPlaceholder")}
            />
          </Field>

          {requestType === "transfer_customer" && (
            <Field>
              <Label htmlFor="target-user">{t("customers.transferTarget")}</Label>
              <Select
                id="target-user"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
              >
                <option value="">{t("customers.selectStaff")}</option>
                {staffUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.email})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {requestType === "paid_customer" && (
            <>
              <Field>
                <Label htmlFor="paid-service-items">
                  {t("customers.paidServiceItems")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="paid-service-items"
                  value={serviceItems}
                  onChange={(e) => setServiceItems(e.target.value)}
                  placeholder={t("customers.paidServiceItemsPlaceholder")}
                />
              </Field>
              <Field>
                <Label htmlFor="paid-amount">
                  {t("customers.paidAmount")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="paid-amount"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="paid-at">
                  {t("customers.paidAt")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="paid-at"
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="paid-remarks">{t("customers.paidRemarks")}</Label>
                <Textarea
                  id="paid-remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={t("customers.paidRemarksPlaceholder")}
                  rows={3}
                />
              </Field>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!reason.trim() || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? t("customers.submitting") : t("customers.submitRequest")}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
