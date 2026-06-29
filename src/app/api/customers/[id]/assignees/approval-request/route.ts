export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getRequestMeta } from "@/lib/auth/cookies";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import {
  createCustomerAssigneeUpdateApprovalRequest,
  toAssigneeApprovalPermissionError,
  type AssigneeApprovalError,
} from "@/lib/customers/assignees-approval";
import { PermissionError } from "@/lib/permissions/customers";

type RouteContext = { params: Promise<{ id: string }> };

function assigneeApprovalErrorResponse(error: AssigneeApprovalError): Response {
  return Response.json(
    {
      error: error.message,
      errorCode: error.errorCode,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    },
    { status: error.status },
  );
}

async function handlePermissionError(
  request: Request,
  userId: string,
  customerId: string,
  error: unknown,
): Promise<Response | null> {
  const mapped = toAssigneeApprovalPermissionError(error);
  if (!mapped) {
    return null;
  }

  if (error instanceof PermissionError) {
    await logPermissionDenied(request, {
      action: error.auditAction ?? "permission.denied.customer_assignees_request",
      userId,
      entityType: "customer",
      entityId: customerId,
    });
  }

  return assigneeApprovalErrorResponse(mapped);
}

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

    const body = await request.json();
    const db = getDb();

    try {
      const result = await createCustomerAssigneeUpdateApprovalRequest(
        db,
        customer,
        user,
        body,
        { ipAddress, userAgent },
      );
      return Response.json({ ok: true, id: result.id });
    } catch (error) {
      const permissionResponse = await handlePermissionError(
        request,
        user.id,
        id,
        error,
      );
      if (permissionResponse) {
        return permissionResponse;
      }

      if (
        error &&
        typeof error === "object" &&
        "errorCode" in error &&
        "status" in error
      ) {
        return assigneeApprovalErrorResponse(error as AssigneeApprovalError);
      }

      throw error;
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
