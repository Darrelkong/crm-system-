export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getRequestMeta } from "@/lib/auth/cookies";
import { assertCanSubmitApprovalRequest } from "@/lib/permissions/approvals";
import { PermissionError } from "@/lib/permissions/customers";
import { getCustomerById } from "@/lib/customers/queries";
import {
  ApprovalError,
  approvalErrorResponse,
  createApprovalRequest,
} from "@/lib/approvals/service";
import type { ApprovalRequestInput } from "@/lib/approvals/validation";

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

    try {
      assertCanSubmitApprovalRequest(user, customer);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: err.auditAction ?? "approval.request_failed.permission_denied",
          userId: user.id,
          entityType: "customer",
          entityId: id,
        });
      }
      throw err;
    }

    const body = (await request.json()) as ApprovalRequestInput;

    try {
      const result = await createApprovalRequest(customer, user, body, {
        ipAddress,
        userAgent,
      });
      return Response.json({ ok: true, id: result.id });
    } catch (err) {
      if (err instanceof ApprovalError && err.code === "validation") {
        const fieldErrors = (
          err as ApprovalError & { fieldErrors?: { field: string; message: string }[] }
        ).fieldErrors;
        return Response.json(
          { error: err.message, fieldErrors: fieldErrors ?? [] },
          { status: 400 },
        );
      }
      throw err;
    }
  } catch (error) {
    if (error instanceof ApprovalError) {
      return approvalErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}
