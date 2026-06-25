"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { resolveClaimBlockReason } from "@/i18n/resolve-claim-block-reason";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { PublicPoolCustomerView } from "@/lib/public-pool/queries";

export function PublicPoolClient({
  initialItems,
  isAdmin,
}: {
  initialItems: PublicPoolCustomerView[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const { source, salesStage } = useCustomerLabels();
  const [items, setItems] = useState(initialItems);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  async function handleClaim(id: string) {
    setClaimingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/public-pool/customers/${id}/claim`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        errorCode?: string;
        code?: string;
      };

      if (res.ok) {
        setItems((prev) => prev.filter((c) => c.id !== id));
        router.refresh();
        return;
      }

      setError(resolveApiError(t, data));
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setClaimingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-slate-500">{t("publicPool.noClients")}</p>
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
              <th className="px-4 py-3 text-left font-medium text-slate-600">
                {t("publicPool.clientName")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">
                {t("publicPool.clientSource")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">
                {t("publicPool.salesStage")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">
                {t("publicPool.poolEnteredAt")}
              </th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">
                {t("publicPool.poolReason")}
              </th>
              {isAdmin && (
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  {t("publicPool.contact")}
                </th>
              )}
              <th className="px-4 py-3 text-left font-medium text-slate-600">
                {t("publicPool.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((c) => {
              const blockReason = resolveClaimBlockReason(
                t,
                c.claimBlockedReasonKey,
                c.claimBlockedReasonParams,
              );

              return (
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
                        {t("publicPool.masked")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{source(c.source)}</td>
                  <td className="px-4 py-3 text-slate-600">{salesStage(c.salesStage)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {c.poolEnteredAt?.slice(0, 16).replace("T", " ") ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.poolReason ?? "—"}</td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-slate-600">
                      {c.phone ?? "—"}
                      {c.wechatId && (
                        <span className="block text-xs text-slate-500">
                          {t("publicPool.wechat")}：{c.wechatId}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={!c.canClaim || claimingId === c.id}
                      onClick={() => handleClaim(c.id)}
                      title={blockReason ?? undefined}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {claimingId === c.id
                        ? t("publicPool.claiming")
                        : t("publicPool.claim")}
                    </button>
                    {!c.canClaim && blockReason && (
                      <p className="mt-1 max-w-[140px] text-xs text-red-600">{blockReason}</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
