"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { CUSTOMER_SOURCE_LABELS } from "@/lib/constants/customer-source-labels";
import { SALES_STAGE_LABELS } from "@/lib/constants/customer-fields";
import type { CustomerSourceKey } from "@/lib/constants/customer-sources";
import type { SalesStage } from "@/lib/constants/customer-fields";
import type { PublicPoolCustomerView } from "@/lib/public-pool/queries";

export function PublicPoolClient({
  initialItems,
  isAdmin,
}: {
  initialItems: PublicPoolCustomerView[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClaim(id: string) {
    setClaimingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/public-pool/customers/${id}/claim`, {
        method: "POST",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (res.ok) {
        setItems((prev) => prev.filter((c) => c.id !== id));
        router.refresh();
        return;
      }

      setError(data.error ?? "领取失败");
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setClaimingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-slate-500">公共池暂无客户</p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">客户名称</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">来源</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">销售阶段</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">入池时间</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">入池原因</th>
              {isAdmin && (
                <th className="px-4 py-3 text-left font-medium text-slate-600">联系方式</th>
              )}
              <th className="px-4 py-3 text-left font-medium text-slate-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/customers/${c.id}`}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    {c.customerName}
                  </Link>
                  {c.isMasked && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      脱敏
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {CUSTOMER_SOURCE_LABELS[c.source as CustomerSourceKey] ?? c.source}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {SALES_STAGE_LABELS[c.salesStage as SalesStage] ?? c.salesStage}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {c.poolEnteredAt?.slice(0, 16).replace("T", " ") ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.poolReason ?? "—"}</td>
                {isAdmin && (
                  <td className="px-4 py-3 text-slate-600">
                    {c.phone ?? "—"}
                    {c.wechatId && (
                      <span className="block text-xs text-slate-500">微信：{c.wechatId}</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={!c.canClaim || claimingId === c.id}
                    onClick={() => handleClaim(c.id)}
                    title={c.claimBlockedReason ?? undefined}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {claimingId === c.id ? "领取中…" : "领取"}
                  </button>
                  {!c.canClaim && c.claimBlockedReason && (
                    <p className="mt-1 max-w-[140px] text-xs text-red-600">
                      {c.claimBlockedReason}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
