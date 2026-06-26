"use client";

import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { resolveClaimBlockReason } from "@/i18n/resolve-claim-block-reason";
import type { AdminClaimStatus, StaffClaimStatus } from "@/lib/public-pool/constants";
import type { PublicPoolCustomerView } from "@/lib/public-pool/queries";
import { PublicPoolClient } from "./public-pool-client";
import { formatHongKongDateTime } from "@/lib/timezone";

type Props = {
  items: PublicPoolCustomerView[];
  isAdmin: boolean;
  claimStatus: StaffClaimStatus | AdminClaimStatus;
};

export function PublicPoolPageClient({ items, isAdmin, claimStatus }: Props) {
  const { t } = useTranslation();

  return (
    <div>
      <PageIntro
        title={t("publicPool.pageTitle")}
        description={t(isAdmin ? "publicPool.subtitleAdmin" : "publicPool.subtitleStaff")}
      />

      {!isAdmin && "quotaLimit" in claimStatus && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="surface-card p-4">
            <p className="text-xs text-[#6B7890]">{t("publicPool.claimedLast7Days")}</p>
            <p className="mt-1 text-xl font-semibold">
              {claimStatus.claimedInLast7Days} / {claimStatus.quotaLimit}
            </p>
          </div>
          <div className="surface-card p-4">
            <p className="text-xs text-[#6B7890]">{t("publicPool.remainingQuota")}</p>
            <p className="mt-1 text-xl font-semibold">{claimStatus.remainingQuota}</p>
          </div>
          <div className="surface-card p-4">
            <p className="text-xs text-[#6B7890]">{t("publicPool.claimStatus")}</p>
            <p className="mt-1 text-sm font-medium text-[#172033]">
              {claimStatus.canClaimNow
                ? t("publicPool.canClaim")
                : resolveClaimBlockReason(
                    t,
                    claimStatus.blockedReasonKey,
                    claimStatus.blockedReasonParams,
                  )}
            </p>
            {claimStatus.cooldownUntil && (
              <p className="mt-1 text-xs text-[#6B7890]">
                {t("publicPool.cooldownUntil", {
                  date: formatHongKongDateTime(claimStatus.cooldownUntil),
                })}
              </p>
            )}
          </div>
        </div>
      )}

      <PublicPoolClient initialItems={items} isAdmin={isAdmin} />
    </div>
  );
}
