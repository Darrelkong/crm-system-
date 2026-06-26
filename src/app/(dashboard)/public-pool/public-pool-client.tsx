"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  TableBody,
  TableHead,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
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
    return <EmptyState message={t("publicPool.noClients")} />;
  }

  return (
    <div>
      {error && (
        <div className="alert-error mb-4 px-4 py-3 text-sm">{error}</div>
      )}

      <TableShell>
        <DataTable>
          <TableHead>
            <tr>
              <Th>{t("publicPool.clientName")}</Th>
              <Th>{t("publicPool.clientSource")}</Th>
              <Th>{t("publicPool.salesStage")}</Th>
              <Th>{t("publicPool.poolEnteredAt")}</Th>
              <Th>{t("publicPool.poolReason")}</Th>
              {isAdmin && <Th>{t("publicPool.contact")}</Th>}
              <Th>{t("publicPool.actions")}</Th>
            </tr>
          </TableHead>
          <TableBody>
            {items.map((c) => {
              const blockReason = resolveClaimBlockReason(
                t,
                c.claimBlockedReasonKey,
                c.claimBlockedReasonParams,
              );

              return (
                <Tr key={c.id}>
                  <Td>
                    <Link
                      href={`/customers/${c.id}`}
                      className="link-primary font-medium hover:underline"
                    >
                      {c.customerName}
                    </Link>
                    {c.isMasked && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        {t("publicPool.masked")}
                      </span>
                    )}
                  </Td>
                  <Td className="text-[#6B7890]">{source(c.source)}</Td>
                  <Td className="text-[#6B7890]">{salesStage(c.salesStage)}</Td>
                  <Td className="text-[#6B7890]">
                    {c.poolEnteredAt?.slice(0, 16).replace("T", " ") ?? "—"}
                  </Td>
                  <Td className="text-[#6B7890]">{c.poolReason ?? "—"}</Td>
                  {isAdmin && (
                    <Td className="text-[#6B7890]">
                      {c.phone ?? "—"}
                      {c.wechatId && (
                        <span className="block text-xs text-[#6B7890]">
                          {t("publicPool.wechat")}：{c.wechatId}
                        </span>
                      )}
                    </Td>
                  )}
                  <Td>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!c.canClaim || claimingId === c.id}
                      onClick={() => handleClaim(c.id)}
                      title={blockReason ?? undefined}
                    >
                      {claimingId === c.id
                        ? t("publicPool.claiming")
                        : t("publicPool.claim")}
                    </Button>
                    {!c.canClaim && blockReason && (
                      <p className="mt-1 max-w-[140px] text-xs text-red-600">{blockReason}</p>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TableBody>
        </DataTable>
      </TableShell>
    </div>
  );
}
