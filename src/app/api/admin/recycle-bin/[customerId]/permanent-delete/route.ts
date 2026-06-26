export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  RecycleBinError,
  permanentlyDeleteCustomerFromRecycleBin,
} from "@/lib/recycle-bin/service";
import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";

type RouteContext = { params: Promise<{ customerId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const { customerId } = await context.params;

    await permanentlyDeleteCustomerFromRecycleBin(actor, customerId, {
      ipAddress,
      userAgent,
      source: "manual",
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof RecycleBinError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
