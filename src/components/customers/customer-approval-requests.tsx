"use client";

import { useEffect, useMemo, useState } from "react";
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

type PriorityMode = "set" | "unset" | null;

type Props = {
  customerId: string;
  isPinned: boolean;
  salesStage: string;
  isAdmin: boolean;
  pendingPriorityApproval: boolean;
};

function isPriorityRequestType(
  type: ApprovalRequestType,
): type is "set_priority_customer" | "unset_priority_customer" {
  return (
    type === "set_priority_customer" || type === "unset_priority_customer"
  );
}

export function CustomerApprovalRequests({
  customerId,
  isPinned,
  salesStage,
  isAdmin,
  pendingPriorityApproval,
}: Props) {
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

  const priorityMode: PriorityMode = useMemo(() => {
    if (pendingPriorityApproval) return null;
    if (!isPinned) return "set";
    if (salesStage === "on_hold") return null;
    return "unset";
  }, [pendingPriorityApproval, isPinned, salesStage]);

  const requestTypes = useMemo(() => {
    const types: ApprovalRequestType[] = [...CUSTOMER_DETAIL_APPROVAL_REQUEST_TYPES];
    if (priorityMode === "set") {
      types.push("set_priority_customer");
    } else if (priorityMode === "unset") {
      types.push("unset_priority_customer");
    }
    return types;
  }, [priorityMode]);

  const isPriorityRequest = isPriorityRequestType(requestType);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/users/staff")
      .then((res) => res.json())
      .then((data: { items?: StaffUser[] }) => setStaffUsers(data.items ?? []))
      .catch(() => setStaffUsers([]));
  }, [open]);

  function priorityActionLabel(type: "set" | "unset"): string {
    if (isAdmin) {
      return type === "set"
        ? t("customers.prioritySetDirect")
        : t("customers.priorityUnsetDirect");
    }
    return type === "set"
      ? t("customers.prioritySetRequest")
      : t("customers.priorityUnsetRequest");
  }

  function priorityCurrentStateMessage(): string | null {
    if (!isPriorityRequest) return null;
    if (requestType === "set_priority_customer") {
      return t("customers.priorityCurrentNotPriority");
    }
    return t("customers.priorityCurrentIsPriority");
  }

  function submitButtonLabel(): string {
    if (!isPriorityRequest) {
      return submitting ? t("customers.submitting") : t("customers.submitRequest");
    }
    if (isAdmin) {
      if (submitting) return t("customers.submitting");
      return requestType === "set_priority_customer"
        ? t("customers.priorityConfirmSet")
        : t("customers.priorityConfirmUnset");
    }
    return submitting ? t("customers.submitting") : t("customers.submitRequest");
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    if (isPriorityRequest) {
      const action = requestType === "set_priority_customer" ? "set" : "unset";
      if (!isAdmin && !reason.trim()) {
        setError(t("customers.approvalReasonRequired"));
        setSubmitting(false);
        return;
      }

      try {
        const res = await fetch(`/api/customers/${customerId}/priority`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reason: reason.trim() || undefined,
          }),
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
      return;
    }

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

  const reasonRequired = !isPriorityRequest || !isAdmin;
  const canSubmit =
    (!reasonRequired || reason.trim().length > 0) &&
    !submitting &&
    !(isPriorityRequest && pendingPriorityApproval);

  if (pendingPriorityApproval && !open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="secondary" disabled>
          {t("customers.submitApproval")}
        </Button>
        <p className="max-w-xs text-right text-xs text-[#6B7890]">
          {t("customers.priorityApprovalPending")}
        </p>
      </div>
    );
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

        {isPinned && salesStage === "on_hold" && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t("customers.priorityOnHoldExplanation")}
          </p>
        )}

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
              {requestTypes.map((typeKey) => (
                <option key={typeKey} value={typeKey}>
                  {isPriorityRequestType(typeKey)
                    ? priorityActionLabel(
                        typeKey === "set_priority_customer" ? "set" : "unset",
                      )
                    : approvalType(typeKey)}
                </option>
              ))}
            </Select>
          </Field>

          {isPriorityRequest && priorityCurrentStateMessage() && (
            <div className="rounded-lg border border-[#E8EDF2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#172033]">
              <p className="text-xs font-medium text-[#6B7890]">
                {t("customers.priorityCurrentStateLabel")}
              </p>
              <p className="mt-1">{priorityCurrentStateMessage()}</p>
            </div>
          )}

          <Field>
            <Label htmlFor="approval-reason">
              {t("customers.approvalReason")}{" "}
              {reasonRequired && <span className="text-red-500">*</span>}
            </Label>
            <Input
              id="approval-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isPriorityRequest
                  ? requestType === "set_priority_customer"
                    ? t("customers.prioritySetReasonPlaceholder")
                    : t("customers.priorityUnsetReasonPlaceholder")
                  : t("customers.approvalReasonPlaceholder")
              }
            />
          </Field>

          {isPriorityRequest && !isAdmin && (
            <p className="text-xs text-[#6B7890]">
              {t("customers.priorityStaffSubmitNote")}
            </p>
          )}

          {isPriorityRequest && isAdmin && (
            <p className="text-xs text-[#6B7890]">
              {requestType === "set_priority_customer"
                ? t("customers.priorityAdminSetNote")
                : t("customers.priorityAdminUnsetNote")}
            </p>
          )}

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
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {submitButtonLabel()}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
