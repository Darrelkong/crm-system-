"use client";

import { useTranslation } from "@/i18n/provider";
import { resolveClaimBlockReason } from "@/i18n/resolve-claim-block-reason";
import type { StaffClaimStatus } from "@/lib/public-pool/constants";
import { formatHongKongDateTime } from "@/lib/timezone";

type Props = {
  staffStatus: StaffClaimStatus;
};

export function StaffMobileClaimSummary({ staffStatus }: Props) {
  const { t } = useTranslation();

  const statusLabel = staffStatus.canClaimNow
    ? t("publicPool.canClaim")
    : resolveClaimBlockReason(
        t,
        staffStatus.blockedReasonKey,
        staffStatus.blockedReasonParams,
      );

  return (
    <div className="surface-card mb-4 p-4 md:hidden">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <div className="min-w-0">
          <p className="text-xs crm-text-secondary">
            {t("publicPool.claimedLast7Days")}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums crm-text">
            {staffStatus.claimedInLast7Days} / {staffStatus.quotaLimit}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs crm-text-secondary">
            {t("publicPool.remainingQuota")}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums crm-text">
            {staffStatus.remainingQuota}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t crm-border pt-4">
        <div className="min-w-0">
          <p className="text-xs crm-text-secondary">
            {t("publicPool.claimStatus")}
          </p>
          <p className="mt-1 text-sm font-medium [overflow-wrap:anywhere] crm-text">
            {statusLabel}
          </p>
        </div>
        {staffStatus.cooldownUntil ? (
          <div className="min-w-0">
            <p className="text-xs crm-text-secondary">
              {t("publicPool.cooldownUntilLabel")}
            </p>
            <p className="mt-1 text-sm tabular-nums [overflow-wrap:anywhere] crm-text">
              {formatHongKongDateTime(staffStatus.cooldownUntil)}
            </p>
          </div>
        ) : (
          <div aria-hidden className="min-w-0" />
        )}
      </div>
    </div>
  );
}
