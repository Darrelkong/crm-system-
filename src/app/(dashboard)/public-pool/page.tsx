export const dynamic = "force-dynamic";

import { requireAuthCached } from "@/lib/auth/request-cache";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import type { AdminClaimStatus } from "@/lib/public-pool/constants";
import { formatPublicPoolListForUser } from "@/lib/public-pool/queries";
import { PublicPoolPageClient } from "./public-pool-page-client";

const ADMIN_CLAIM_STATUS: AdminClaimStatus = {
  unlimited: true,
  canClaimNow: true,
  claimedInLast7Days: null,
  remainingQuota: null,
  cooldownUntil: null,
  blockedReasonKey: null,
};

export default async function PublicPoolPage() {
  const user = await requireAuthCached();
  const isAdmin = user.role === "admin";

  const [items, claimStatus] = await Promise.all([
    isAdmin
      ? formatPublicPoolListForUser(user)
      : Promise.resolve([] as Awaited<
          ReturnType<typeof formatPublicPoolListForUser>
        >),
    isAdmin ? Promise.resolve(ADMIN_CLAIM_STATUS) : getStaffClaimStatus(user.id),
  ]);

  return (
    <PublicPoolPageClient
      items={items}
      isAdmin={isAdmin}
      claimStatus={claimStatus}
    />
  );
}
