export const dynamic = "force-dynamic";

import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";
import { getRequestMeta } from "@/lib/auth/cookies";
import {
  ApprovalError,
  approvalErrorResponse,
  rejectApprovalRequest,
} from "@/lib/approvals/service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAdmin(request);
    const { id } = await context.params;
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as { adminComment?: string };

    await rejectApprovalRequest(
      id,
      user,
      typeof body.adminComment === "string" ? body.adminComment : undefined,
      { ipAddress, userAgent },
    );

    return Response.json({ ok: true, id });
  } catch (error) {
    if (error instanceof ApprovalError) {
      return approvalErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}
