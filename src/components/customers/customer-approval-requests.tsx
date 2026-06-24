"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Field, Select } from "@/components/ui/form";
import type { ApprovalRequestType } from "../../../drizzle/schema/approvals";

type StaffUser = { id: string; displayName: string; email: string };

const REQUEST_OPTIONS: { value: ApprovalRequestType; label: string }[] = [
  { value: "delete_customer", label: "申请删除" },
  { value: "transfer_customer", label: "申请转移" },
  { value: "merge_customers", label: "申请合并" },
  { value: "closed_won", label: "申请成交" },
  { value: "second_conversion", label: "申请二次转化" },
];

export function CustomerApprovalRequests({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState<ApprovalRequestType>("delete_customer");
  const [reason, setReason] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [relatedCustomerIds, setRelatedCustomerIds] = useState("");
  const [dealAmount, setDealAmount] = useState("");
  const [signingDate, setSigningDate] = useState("");
  const [dealNotes, setDealNotes] = useState("");
  const [opportunityDescription, setOpportunityDescription] = useState("");
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [nextAction, setNextAction] = useState("");
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

    const payload: Record<string, unknown> = {};
    if (requestType === "closed_won") {
      payload.dealAmount = dealAmount;
      payload.signingDate = signingDate;
      if (dealNotes.trim()) payload.dealNotes = dealNotes.trim();
    }
    if (requestType === "second_conversion") {
      if (opportunityDescription.trim()) {
        payload.opportunityDescription = opportunityDescription.trim();
      }
      if (estimatedAmount.trim()) payload.estimatedAmount = estimatedAmount.trim();
      if (nextAction.trim()) payload.nextAction = nextAction.trim();
    }

    const body: Record<string, unknown> = {
      requestType,
      reason: reason.trim(),
    };

    if (requestType === "transfer_customer") {
      body.targetUserId = targetUserId;
    }
    if (requestType === "merge_customers") {
      body.relatedCustomerIds = relatedCustomerIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    }
    if (requestType === "closed_won" || requestType === "second_conversion") {
      body.payload = payload;
    }

    try {
      const res = await fetch(`/api/customers/${customerId}/approval-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        fieldErrors?: { field: string; message: string }[];
      };

      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }

      if (data.fieldErrors?.length) {
        setError(data.fieldErrors.map((e) => e.message).join("；"));
        return;
      }

      setError(data.error ?? "提交失败");
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        提交审批申请
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-slate-900">提交审批申请</h3>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4 space-y-4">
          <Field>
            <Label htmlFor="request-type">申请类型</Label>
            <Select
              id="request-type"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as ApprovalRequestType)}
            >
              {REQUEST_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            <Label htmlFor="approval-reason">
              申请原因 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="approval-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请填写申请原因"
            />
          </Field>

          {requestType === "transfer_customer" && (
            <Field>
              <Label htmlFor="target-user">转移目标员工</Label>
              <Select
                id="target-user"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
              >
                <option value="">请选择员工</option>
                {staffUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.email})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {requestType === "merge_customers" && (
            <Field>
              <Label htmlFor="related-ids">相关客户 ID（逗号分隔）</Label>
              <Input
                id="related-ids"
                value={relatedCustomerIds}
                onChange={(e) => setRelatedCustomerIds(e.target.value)}
                placeholder="22222222-2222-2222-2222-222222222202"
              />
            </Field>
          )}

          {requestType === "closed_won" && (
            <>
              <Field>
                <Label htmlFor="deal-amount">成交金额</Label>
                <Input
                  id="deal-amount"
                  value={dealAmount}
                  onChange={(e) => setDealAmount(e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="signing-date">签约日期</Label>
                <Input
                  id="signing-date"
                  type="date"
                  value={signingDate}
                  onChange={(e) => setSigningDate(e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="deal-notes">成交备注</Label>
                <Input
                  id="deal-notes"
                  value={dealNotes}
                  onChange={(e) => setDealNotes(e.target.value)}
                />
              </Field>
            </>
          )}

          {requestType === "second_conversion" && (
            <>
              <Field>
                <Label htmlFor="opportunity-desc">机会描述</Label>
                <Input
                  id="opportunity-desc"
                  value={opportunityDescription}
                  onChange={(e) => setOpportunityDescription(e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="estimated-amount">预估金额</Label>
                <Input
                  id="estimated-amount"
                  value={estimatedAmount}
                  onChange={(e) => setEstimatedAmount(e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="next-action">下一步行动</Label>
                <Input
                  id="next-action"
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            取消
          </button>
          <Button
            type="button"
            disabled={!reason.trim() || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "提交中…" : "提交申请"}
          </Button>
        </div>
      </div>
    </div>
  );
}
