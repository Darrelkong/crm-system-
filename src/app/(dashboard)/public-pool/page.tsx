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

  const staffClaimStatus =
    user.role === "staff" ? await getStaffClaimStatus(user.id) : null;

  const items = await formatPublicPoolListForUser(user, {
    staffStatus: staffClaimStatus,
  });

  const claimStatus =
    user.role === "staff" ? staffClaimStatus! : ADMIN_CLAIM_STATUS;

  return (
    <PublicPoolPageClient
      items={items}
      isAdmin={user.role === "admin"}
      claimStatus={claimStatus}
    />
  );
}
