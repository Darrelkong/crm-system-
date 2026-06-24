export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import { evaluateCustomerClaimEligibility } from "@/lib/public-pool/queries";
import { claimCustomerFromPool } from "@/lib/public-pool/service";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRequestMeta } from "@/lib/auth/cookies";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const { ipAddress, userAgent } = getRequestMeta(request);

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json({ error: "客户不存在" }, { status: 404 });
    }

    if (customer.status !== "public_pool") {
      await writeAuditLog({
        userId: user.id,
        action: "customer.claim_failed.not_in_pool",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
      });
      return Response.json({ error: "客户不在公共池" }, { status: 400 });
    }

    const staffStatus =
      user.role === "staff" ? await getStaffClaimStatus(user.id) : null;

    const eligibility = evaluateCustomerClaimEligibility(
      user,
      customer,
      staffStatus,
    );

    if (!eligibility.canClaim) {
      const releasedBy = customer.releasedBy ?? customer.releaserUserId;
      let action = "customer.claim_failed.not_in_pool";
      let status = 403;

      if (releasedBy === user.id) {
        action = "customer.claim_failed.released_by_self";
      } else if (staffStatus?.inCooldown) {
        action = "customer.claim_failed.cooldown";
      } else if (staffStatus && staffStatus.remainingQuota <= 0) {
        action = "customer.claim_failed.quota_exceeded";
        status = 429;
      }

      await writeAuditLog({
        userId: user.id,
        action,
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: { reason: eligibility.claimBlockedReason },
      });

      return Response.json(
        { error: eligibility.claimBlockedReason ?? "无法领取该客户" },
        { status },
      );
    }

    const { taskId } = await claimCustomerFromPool(customer, user, {
      ipAddress,
      userAgent,
    });

    return Response.json({ ok: true, id, taskId });
  } catch (error) {
    return authErrorResponse(error);
  }
}
