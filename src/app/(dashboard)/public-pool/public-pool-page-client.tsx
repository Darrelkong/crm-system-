"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { StaffMobileClaimSummary } from "./staff-mobile-claim-summary";
import { StaffQuickEntryPanel } from "./staff-quick-entry-panel";
import {
  StaffDesktopPublicPoolLoader,
  type StaffDesktopListControls,
} from "./staff-desktop-public-pool-loader";
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
  const staffListControlsRef = useRef<StaffDesktopListControls | null>(null);

  const handleStaffListControlsReady = useCallback(
    (controls: StaffDesktopListControls) => {
      staffListControlsRef.current = controls;
    },
    [],
  );

  useEffect(() => {
    setClaimStatus(initialClaimStatus);
  }, [initialClaimStatus]);

  useEffect(() => {
    if (isAdmin) {
      setListItems(items);
    }
  }, [items, isAdmin]);

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

      {staffStatus && <StaffMobileClaimSummary staffStatus={staffStatus} />}

      {staffStatus && (
        <div className="mb-6 hidden gap-4 md:grid sm:grid-cols-3">
          <div className="surface-card p-4">
            <p className="text-xs crm-text-secondary">
              {t("publicPool.claimedLast7Days")}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums crm-text">
              {staffStatus.claimedInLast7Days} / {staffStatus.quotaLimit}
            </p>
          </div>
          <div className="surface-card p-4">
            <p className="text-xs crm-text-secondary">
              {t("publicPool.remainingQuota")}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums crm-text">
              {staffStatus.remainingQuota}
            </p>
          </div>
          <div className="surface-card p-4">
            <p className="text-xs crm-text-secondary">
              {t("publicPool.claimStatus")}
            </p>
            <p className="mt-1 text-sm font-medium crm-text">
              {staffStatus.canClaimNow
                ? t("publicPool.canClaim")
                : resolveClaimBlockReason(
                    t,
                    staffStatus.blockedReasonKey,
                    staffStatus.blockedReasonParams,
                  )}
            </p>
            {staffStatus.cooldownUntil && (
              <p className="mt-1 text-xs crm-text-secondary">
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
            if (isAdmin) {
              setListItems((prev) => prev.filter((c) => c.id !== customerId));
              return;
            }
            staffListControlsRef.current?.removeCustomer(customerId);
          }}
        />
      )}

      <StaffQuickEntryPanel
        isAdmin={isAdmin}
        onViewPoolRefresh={
          isAdmin
            ? undefined
            : () => staffListControlsRef.current?.refreshList()
        }
      />

      {!isAdmin && (
        <p className="mb-4 hidden text-sm crm-text-secondary md:block">
          {t("publicPool.maskedDataNotice")}
        </p>
      )}

      {isAdmin ? (
        <PublicPoolClient initialItems={listItems} isAdmin />
      ) : (
        <StaffDesktopPublicPoolLoader
          onControlsReady={handleStaffListControlsReady}
        />
      )}
    </div>
  );
}
