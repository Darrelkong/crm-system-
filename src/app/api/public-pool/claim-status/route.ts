export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);

    if (user.role === "admin") {
      return Response.json({
        unlimited: true,
        canClaimNow: true,
        claimedInLast7Days: null,
        remainingQuota: null,
        cooldownUntil: null,
        blockedReason: null,
      });
    }

    const status = await getStaffClaimStatus(user.id);
    return Response.json(status);
  } catch (error) {
    return authErrorResponse(error);
  }
}
