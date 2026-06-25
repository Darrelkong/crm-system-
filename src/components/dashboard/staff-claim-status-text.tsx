"use client";

import { useTranslation } from "@/i18n/provider";
import { resolveClaimBlockReason } from "@/i18n/resolve-claim-block-reason";

export function StaffClaimStatusText({
  canClaimNow,
  blockedReasonKey,
  blockedReasonParams,
}: {
  canClaimNow: boolean;
  blockedReasonKey: string | null;
  blockedReasonParams?: Record<string, string>;
}) {
  const { t } = useTranslation();

  if (canClaimNow) {
    return <>{t("publicPool.canClaim")}</>;
  }

  return (
    <>
      {resolveClaimBlockReason(t, blockedReasonKey, blockedReasonParams) ?? "—"}
    </>
  );
}
