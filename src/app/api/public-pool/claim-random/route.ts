export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getRequestMeta } from "@/lib/auth/cookies";
import {
  claimRandomCustomerFromPoolForStaff,
  type ClaimRandomCustomerResult,
} from "@/lib/public-pool/random-claim-service";
import {
  randomClaimRoleGate,
  validateRandomClaimRequestBody,
} from "@/lib/public-pool/random-claim-request";
import type { User } from "../../../../../drizzle/schema/users";

/**
 * Injectable deps for Route Handler unit tests.
 * Production POST always uses defaults — never accept deps from the client.
 */
export type ClaimRandomRouteDeps = {
  requireAuth: (request: Request) => Promise<User>;
  getRequestMeta: (request: Request) => {
    ipAddress: string | null;
    userAgent: string | null;
  };
  claimRandomCustomerFromPoolForStaff: (input: {
    user: User;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) => Promise<ClaimRandomCustomerResult>;
};

const defaultDeps: ClaimRandomRouteDeps = {
  requireAuth,
  getRequestMeta,
  claimRandomCustomerFromPoolForStaff,
};

/**
 * Shared Route Handler body. Tests call this with mocked deps;
 * production POST delegates here with default wiring.
 */
export async function handleClaimRandomPost(
  request: Request,
  deps: ClaimRandomRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const user = await deps.requireAuth(request);
    const { ipAddress, userAgent } = deps.getRequestMeta(request);

    const roleGate = randomClaimRoleGate(user.role);
    if (!roleGate.ok) {
      return Response.json(
        { error: roleGate.error, errorCode: roleGate.errorCode },
        { status: roleGate.httpStatus },
      );
    }

    const bodyGate = validateRandomClaimRequestBody(await request.text());
    if (!bodyGate.ok) {
      return Response.json(
        { error: bodyGate.error, errorCode: bodyGate.errorCode },
        { status: bodyGate.httpStatus },
      );
    }

    const result = await deps.claimRandomCustomerFromPoolForStaff({
      user,
      ipAddress,
      userAgent,
    });

    if (!result.ok) {
      return Response.json(
        {
          error: result.error,
          errorCode: result.errorCode,
        },
        { status: result.httpStatus },
      );
    }

    return Response.json({
      ok: true,
      customerId: result.customerId,
      customerCode: result.customerCode,
      customerName: result.customerName,
      taskId: result.taskId,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  return handleClaimRandomPost(request);
}
