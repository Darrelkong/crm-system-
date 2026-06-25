"use client";

import { useTranslation } from "@/i18n/provider";
import { resolveClaimBlockReason } from "@/i18n/resolve-claim-block-reason";
import type { AdminClaimStatus, StaffClaimStatus } from "@/lib/public-pool/constants";
import type { PublicPoolCustomerView } from "@/lib/public-pool/queries";
import { PublicPoolClient } from "./public-pool-client";

type Props = {
  items: PublicPoolCustomerView[];
  isAdmin: boolean;
  claimStatus: StaffClaimStatus | AdminClaimStatus;
};

export function PublicPoolPageClient({ items, isAdmin, claimStatus }: Props) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">
          {t("publicPool.pageTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {t(isAdmin ? "publicPool.subtitleAdmin" : "publicPool.subtitleStaff")}
        </p>
      </div>

      {!isAdmin && "quotaLimit" in claimStatus && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{t("publicPool.claimedLast7Days")}</p>
            <p className="mt-1 text-xl font-semibold">
              {claimStatus.claimedInLast7Days} / {claimStatus.quotaLimit}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{t("publicPool.remainingQuota")}</p>
            <p className="mt-1 text-xl font-semibold">{claimStatus.remainingQuota}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{t("publicPool.claimStatus")}</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {claimStatus.canClaimNow
                ? t("publicPool.canClaim")
                : resolveClaimBlockReason(
                    t,
                    claimStatus.blockedReasonKey,
                    claimStatus.blockedReasonParams,
                  )}
            </p>
            {claimStatus.cooldownUntil && (
              <p className="mt-1 text-xs text-slate-500">
                {t("publicPool.cooldownUntil", {
                  date: claimStatus.cooldownUntil.slice(0, 16).replace("T", " "),
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
