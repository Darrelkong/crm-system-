export const dynamic = "force-dynamic";

import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import { listUsersForAdmin } from "@/lib/users-admin/queries";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const users = await listUsersForAdmin();
    const staff = users.filter(
      (user) => user.role === "staff" && user.status === "active",
    );
    const items = await Promise.all(
      staff.map(async (user) => {
        const claimStatus = await getStaffClaimStatus(user.id);
        return {
          ...user,
          next_claim_at: claimStatus.cooldownUntil,
        };
      }),
    );

    return Response.json({ items, total: items.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}
