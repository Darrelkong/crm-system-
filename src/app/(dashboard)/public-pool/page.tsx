export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { formatPublicPoolListForUser } from "@/lib/public-pool/queries";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import type { AdminClaimStatus } from "@/lib/public-pool/constants";
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
  const user = await requireAuth();
  const items = await formatPublicPoolListForUser(user);

  const claimStatus =
    user.role === "staff"
      ? await getStaffClaimStatus(user.id)
      : ADMIN_CLAIM_STATUS;

  return (
    <PublicPoolPageClient
      items={items}
      isAdmin={user.role === "admin"}
      claimStatus={claimStatus}
    />
  );
}
