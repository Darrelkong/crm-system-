"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CompletenessBadge } from "@/components/customers/customer-scores-cards";
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
import {
  maskPublicPoolCustomerName,
  truncatePoolReason,
} from "@/lib/public-pool/display";
import type { PublicPoolCustomerView } from "@/lib/public-pool/queries";
import { formatHongKongDateTime } from "@/lib/timezone";

export function PublicPoolClient({
  initialItems,
  isAdmin,
}: {
  initialItems: PublicPoolCustomerView[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const { customerType } = useCustomerLabels();
  const [items, setItems] = useState(initialItems);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimSuccessId, setClaimSuccessId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  function displayCustomerName(name: string): string {
    return isAdmin ? name : maskPublicPoolCustomerName(name);
  }

  async function handleClaim(id: string) {
    setClaimingId(id);
    setError(null);
    setClaimSuccessId(null);

    try {
      const res = await fetch(`/api/public-pool/customers/${id}/claim`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        id?: string;
        error?: string;
        errorCode?: string;
        code?: string;
      };

      if (res.ok) {
        setItems((prev) => prev.filter((c) => c.id !== id));
        setClaimSuccessId(data.id ?? id);
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

  if (items.length === 0 && !claimSuccessId) {
    return <EmptyState message={t("publicPool.noClients")} />;
  }

  return (
    <div>
      {claimSuccessId && (
        <div className="alert-success mb-4 flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="font-medium text-[#172033]">{t("publicPool.claimSuccess")}</p>
          <Link href={`/customers/${claimSuccessId}`}>
            <Button type="button" size="sm" variant="secondary">
              {t("publicPool.viewNow")}
            </Button>
          </Link>
        </div>
      )}

      {error && (
        <div className="alert-error mb-4 px-4 py-3 text-sm">{error}</div>
      )}

      {items.length === 0 ? (
        <EmptyState message={t("publicPool.noClients")} />
      ) : (
        <TableShell>
          <DataTable>
            <TableHead>
              <tr>
                <Th>{t("publicPool.clientName")}</Th>
                <Th>{t("publicPool.poolClientType")}</Th>
                <Th>{t("publicPool.poolDataCompleteness")}</Th>
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
                const poolReasonDisplay = truncatePoolReason(c.poolReason);

                return (
                  <Tr key={c.id}>
                    <Td>
                      <Link
                        href={`/customers/${c.id}`}
                        className="link-primary font-medium hover:underline"
                      >
                        {displayCustomerName(c.customerName)}
                      </Link>
                      {c.isMasked && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          {t("publicPool.masked")}
                        </span>
                      )}
                    </Td>
                    <Td className="text-[#6B7890]">{customerType(c.customerType)}</Td>
                    <Td>
                      <CompletenessBadge score={c.completenessScore} />
                    </Td>
                    <Td className="text-[#6B7890]">
                      {formatHongKongDateTime(c.poolEnteredAt)}
                    </Td>
                    <Td className="text-[#6B7890]">
                      {poolReasonDisplay ?? "—"}
                    </Td>
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
                        <p className="mt-1 max-w-[140px] text-xs text-red-600">
                          {blockReason}
                        </p>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TableBody>
          </DataTable>
        </TableShell>
      )}
    </div>
  );
}
