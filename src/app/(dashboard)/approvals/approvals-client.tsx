"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  APPROVAL_REQUEST_TYPE_LABELS,
  APPROVAL_STATUS_LABELS,
} from "@/lib/approvals/constants";
import type { ApprovalListItem } from "@/lib/approvals/queries";
import type { ApprovalRequestType, ApprovalStatus } from "../../../../drizzle/schema/approvals";
import { Button } from "@/components/ui/button";
import { Input, Label, Field } from "@/components/ui/form";

type Props = {
  isAdmin: boolean;
};

export function ApprovalsClient({ isAdmin }: Props) {
  const [items, setItems] = useState<ApprovalListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminComment, setAdminComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  async function loadItems(filter: ApprovalStatus | "all") {
    setLoading(true);
    setError(null);
    try {
      const query = filter === "all" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/approvals${query}`);
      const data = (await res.json()) as {
        items?: ApprovalListItem[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "加载失败");
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems(statusFilter);
  }, [statusFilter]);

  async function handleReview(action: "approve" | "reject") {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${selected.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminComment }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "操作失败");
        return;
      }
      setSelectedId(null);
      setAdminComment("");
      await loadItems(statusFilter);
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`rounded-full px-3 py-1 text-sm ${
              statusFilter === status
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {status === "all" ? "全部" : APPROVAL_STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">加载中…</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          暂无申请记录
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id);
                setAdminComment(item.adminComment ?? "");
              }}
              className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-indigo-300"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">
                  {APPROVAL_REQUEST_TYPE_LABELS[item.requestType as ApprovalRequestType]}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {APPROVAL_STATUS_LABELS[item.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                客户：
                <Link
                  href={`/customers/${item.customerId}`}
                  className="text-indigo-600 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.customerName}
                </Link>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                申请人：{item.requestedByName} · 提交于{" "}
                {item.createdAt.slice(0, 16).replace("T", " ")}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-slate-900">申请详情</h3>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">类型</dt>
                <dd>{APPROVAL_REQUEST_TYPE_LABELS[selected.requestType as ApprovalRequestType]}</dd>
              </div>
              <div>
                <dt className="text-slate-500">客户</dt>
                <dd>{selected.customerName}</dd>
              </div>
              <div>
                <dt className="text-slate-500">申请人</dt>
                <dd>{selected.requestedByName}</dd>
              </div>
              <div>
                <dt className="text-slate-500">申请原因</dt>
                <dd className="whitespace-pre-wrap">{selected.reason}</dd>
              </div>
              {selected.targetUserName && (
                <div>
                  <dt className="text-slate-500">转移目标</dt>
                  <dd>{selected.targetUserName}</dd>
                </div>
              )}
              {selected.relatedCustomerIds && selected.relatedCustomerIds.length > 0 && (
                <div>
                  <dt className="text-slate-500">相关客户 ID</dt>
                  <dd>{selected.relatedCustomerIds.join(", ")}</dd>
                </div>
              )}
              {selected.payload && (
                <div>
                  <dt className="text-slate-500">申请详情</dt>
                  <dd className="whitespace-pre-wrap font-mono text-xs">
                    {JSON.stringify(selected.payload, null, 2)}
                  </dd>
                </div>
              )}
              {selected.adminComment && (
                <div>
                  <dt className="text-slate-500">审批意见</dt>
                  <dd className="whitespace-pre-wrap">{selected.adminComment}</dd>
                </div>
              )}
            </dl>

            {isAdmin && selected.status === "pending" && (
              <div className="mt-4">
                <Field>
                  <Label htmlFor="admin-comment">审批意见</Label>
                  <Input
                    id="admin-comment"
                    value={adminComment}
                    onChange={(e) => setAdminComment(e.target.value)}
                    placeholder="可选填写审批意见"
                  />
                </Field>
                <div className="mt-4 flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={submitting}
                    onClick={() => setSelectedId(null)}
                  >
                    关闭
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={submitting}
                    onClick={() => void handleReview("reject")}
                  >
                    驳回
                  </Button>
                  <Button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleReview("approve")}
                  >
                    批准
                  </Button>
                </div>
              </div>
            )}

            {(!isAdmin || selected.status !== "pending") && (
              <div className="mt-4 flex justify-end">
                <Button type="button" variant="secondary" onClick={() => setSelectedId(null)}>
                  关闭
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
