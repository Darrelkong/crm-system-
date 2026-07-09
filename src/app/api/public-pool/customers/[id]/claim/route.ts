export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import { SELF_RELEASE_CLAIM_BLOCK_DAYS } from "@/lib/public-pool/constants";
import {
  claimBlockReasonToErrorCode,
  evaluateCustomerClaimEligibility,
} from "@/lib/public-pool/queries";
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
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
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
      return Response.json(
        {
          error: "客户不在公共池",
          errorCode: "PUBLIC_POOL_CLIENT_NOT_FOUND",
        },
        { status: 400 },
      );
    }

    const staffStatus =
      user.role === "staff" ? await getStaffClaimStatus(user.id) : null;

    const eligibility = evaluateCustomerClaimEligibility(
      user,
      customer,
      staffStatus,
    );

    if (!eligibility.canClaim) {
      let action = "customer.claim_failed.not_in_pool";
      let status = 403;

      switch (eligibility.claimBlockedReasonKey) {
        case "selfReleased":
          action = "customer.claim_failed.released_by_self";
          break;
        case "cooldown":
          action = "customer.claim_failed.cooldown";
          break;
        case "quotaExceeded":
          action = "customer.claim_failed.quota_exceeded";
          status = 429;
          break;
        case "statusUnavailable":
          action = "customer.claim_failed.status_unavailable";
          break;
        default:
          break;
      }

      const errorCode =
        claimBlockReasonToErrorCode(eligibility.claimBlockedReasonKey) ??
        "CANNOT_CLAIM_CLIENT";

      const metadata: Record<string, unknown> = {
        reasonKey: eligibility.claimBlockedReasonKey,
        reasonParams: eligibility.claimBlockedReasonParams,
      };

      if (eligibility.claimBlockedReasonKey === "selfReleased") {
        const params = eligibility.claimBlockedReasonParams;
        metadata.reason = "self_released_within_block_window";
        metadata.blockDays = Number(
          params?.blockDays ?? SELF_RELEASE_CLAIM_BLOCK_DAYS,
        );
        metadata.releasedBy =
          params?.releasedBy ??
          customer.releasedBy ??
          customer.releaserUserId;
        metadata.poolEnteredAt =
          params?.poolEnteredAt ?? customer.poolEnteredAt ?? null;
        metadata.blockedUntil = params?.blockedUntil ?? null;
        if (params?.remainingHours) {
          metadata.remainingHours = Number(params.remainingHours);
        }
        if (params?.remainingDays) {
          metadata.remainingDays = Number(params.remainingDays);
        }
      }

      await writeAuditLog({
        userId: user.id,
        action,
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata,
      });

      return Response.json(
        {
          error: "无法领取该客户",
          errorCode,
        },
        { status },
      );
    }

    const claimResult = await claimCustomerFromPool(customer, user, {
      ipAddress,
      userAgent,
    });

    if (!claimResult.ok) {
      await writeAuditLog({
        userId: user.id,
        action: "customer.claim_failed.already_claimed",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
      });
      return Response.json(
        {
          error: "该客户已被其他员工领取",
          errorCode: "PUBLIC_POOL_CLIENT_ALREADY_CLAIMED",
        },
        { status: 409 },
      );
    }

    return Response.json({ ok: true, id, taskId: claimResult.taskId });
  } catch (error) {
    return authErrorResponse(error);
  }
}
