export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import { SELF_RELEASE_CLAIM_BLOCK_DAYS } from "@/lib/public-pool/constants";
import {
  claimBlockReasonToErrorCode,
  evaluateCustomerClaimEligibility,
} from "@/lib/public-pool/queries";
import { idClaimStaffMethodGate } from "@/lib/public-pool/random-claim-request";
import { claimCustomerFromPool } from "@/lib/public-pool/service";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRequestMeta } from "@/lib/auth/cookies";
import type { User } from "../../../../../../../drizzle/schema/users";
import type { Customer } from "../../../../../../../drizzle/schema/customers";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Injectable deps for Route Handler unit tests.
 * Production POST always uses defaults — never accept deps from the client.
 */
export type IdClaimRouteDeps = {
  requireAuth: (request: Request) => Promise<User>;
  getRequestMeta: (request: Request) => {
    ipAddress: string | null;
    userAgent: string | null;
  };
  getCustomerById: (id: string) => Promise<Customer | null>;
  claimCustomerFromPool: typeof claimCustomerFromPool;
  writeAuditLog: typeof writeAuditLog;
  getStaffClaimStatus: typeof getStaffClaimStatus;
};

const defaultDeps: IdClaimRouteDeps = {
  requireAuth,
  getRequestMeta,
  getCustomerById,
  claimCustomerFromPool,
  writeAuditLog,
  getStaffClaimStatus,
};

/**
 * Shared ID-claim Route Handler. Staff method gate runs before customer load.
 */
export async function handleIdClaimPost(
  request: Request,
  context: RouteContext,
  deps: IdClaimRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const user = await deps.requireAuth(request);
    const { id } = await context.params;
    const { ipAddress, userAgent } = deps.getRequestMeta(request);

    const methodGate = idClaimStaffMethodGate(user.role);
    if (!methodGate.ok) {
      await deps.writeAuditLog({
        userId: user.id,
        action: "customer.claim_failed.method_not_allowed",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: { reason: "staff_must_use_random_claim" },
      });
      return Response.json(
        {
          error: methodGate.error,
          errorCode: methodGate.errorCode,
        },
        { status: methodGate.httpStatus },
      );
    }

    const customer = await deps.getCustomerById(id);
    if (!customer) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    if (customer.status !== "public_pool") {
      await deps.writeAuditLog({
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
      user.role === "staff"
        ? await deps.getStaffClaimStatus(user.id)
        : null;

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

      await deps.writeAuditLog({
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

    const claimResult = await deps.claimCustomerFromPool(customer, user, {
      ipAddress,
      userAgent,
    });

    if (!claimResult.ok) {
      await deps.writeAuditLog({
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

export async function POST(request: Request, context: RouteContext) {
  return handleIdClaimPost(request, context);
}
