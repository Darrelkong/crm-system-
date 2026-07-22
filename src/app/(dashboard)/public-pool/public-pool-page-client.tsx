"use client";

import { useEffect, useState } from "react";
import { PageIntro } from "@/components/ui/page-intro";
import { useTranslation } from "@/i18n/provider";
import { resolveClaimBlockReason } from "@/i18n/resolve-claim-block-reason";
import type {
  AdminClaimStatus,
  StaffClaimStatus,
} from "@/lib/public-pool/constants";
import type { PublicPoolCustomerView } from "@/lib/public-pool/queries";
import { PublicPoolClient } from "./public-pool-client";
import { StaffRandomClaimPanel } from "./staff-random-claim-panel";
import { StaffQuickEntryPanel } from "./staff-quick-entry-panel";
import { shouldShowStaffRandomClaim } from "./random-claim-ui";
import { formatHongKongDateTime } from "@/lib/timezone";

type Props = {
  items: PublicPoolCustomerView[];
  isAdmin: boolean;
  claimStatus: StaffClaimStatus | AdminClaimStatus;
};

export function PublicPoolPageClient({
  items,
  isAdmin,
  claimStatus: initialClaimStatus,
}: Props) {
  const { t } = useTranslation();
  const [claimStatus, setClaimStatus] = useState(initialClaimStatus);
  const [listItems, setListItems] = useState(items);

  useEffect(() => {
    setClaimStatus(initialClaimStatus);
  }, [initialClaimStatus]);

  useEffect(() => {
    setListItems(items);
  }, [items]);

  const staffStatus =
    !isAdmin && "quotaLimit" in claimStatus
      ? (claimStatus as StaffClaimStatus)
      : null;

  return (
    <div>
      <PageIntro
        title={t("publicPool.pageTitle")}
        description={t(
          isAdmin ? "publicPool.subtitleAdmin" : "publicPool.subtitleStaff",
        )}
      />

      {staffStatus && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="surface-card p-4">
            <p className="text-xs text-[#6B7890]">
              {t("publicPool.claimedLast7Days")}
            </p>
            <p className="mt-1 text-xl font-semibold">
              {staffStatus.claimedInLast7Days} / {staffStatus.quotaLimit}
            </p>
          </div>
          <div className="surface-card p-4">
            <p className="text-xs text-[#6B7890]">
              {t("publicPool.remainingQuota")}
            </p>
            <p className="mt-1 text-xl font-semibold">
              {staffStatus.remainingQuota}
            </p>
          </div>
          <div className="surface-card p-4">
            <p className="text-xs text-[#6B7890]">
              {t("publicPool.claimStatus")}
            </p>
            <p className="mt-1 text-sm font-medium text-[#172033]">
              {staffStatus.canClaimNow
                ? t("publicPool.canClaim")
                : resolveClaimBlockReason(
                    t,
                    staffStatus.blockedReasonKey,
                    staffStatus.blockedReasonParams,
                  )}
            </p>
            {staffStatus.cooldownUntil && (
              <p className="mt-1 text-xs text-[#6B7890]">
                {t("publicPool.cooldownUntil", {
                  date: formatHongKongDateTime(staffStatus.cooldownUntil),
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {shouldShowStaffRandomClaim(isAdmin) && staffStatus && (
        <StaffRandomClaimPanel
          claimStatus={staffStatus}
          onClaimStatusChange={setClaimStatus}
          onClaimedCustomer={(customerId) => {
            setListItems((prev) => prev.filter((c) => c.id !== customerId));
          }}
        />
      )}

      <StaffQuickEntryPanel isAdmin={isAdmin} />

      {!isAdmin && (
        <p className="mb-4 text-sm text-[#6B7890]">
          {t("publicPool.maskedDataNotice")}
        </p>
      )}

      <PublicPoolClient initialItems={listItems} isAdmin={isAdmin} />
    </div>
  );
}
