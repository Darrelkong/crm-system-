export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import {
  getCustomerAssigneesAdminPayload,
  toAssigneesPermissionError,
  updateCustomerCollaborators,
  type AssigneesApiError,
} from "@/lib/customers/assignees-api";
import { getCustomerAssigneesPreviewPayload } from "@/lib/customers/assignees-approval";
import { PermissionError } from "@/lib/permissions/customers";

type RouteContext = { params: Promise<{ id: string }> };

function assigneesErrorResponse(error: AssigneesApiError): Response {
  return Response.json(
    {
      error: error.message,
      errorCode: error.errorCode,
    },
    { status: error.status },
  );
}

async function handleAssigneesPermissionError(
  request: Request,
  userId: string,
  customerId: string,
  error: unknown,
): Promise<Response | null> {
  const mapped = toAssigneesPermissionError(error);
  if (!mapped) {
    return null;
  }

  if (error instanceof PermissionError) {
    await logPermissionDenied(request, {
      action: error.auditAction ?? "permission.denied.customer_assignees_manage",
      userId,
      entityType: "customer",
      entityId: customerId,
    });
  }

  return assigneesErrorResponse(mapped);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const db = getDb();
    try {
      const payload = await getCustomerAssigneesPreviewPayload(
        db,
        user,
        customer,
      );
      return Response.json({
        ok: true,
        owner: payload.owner,
        collaborators: payload.collaborators,
        availableStaff: payload.availableStaff,
      });
    } catch (error) {
      const response = await handleAssigneesPermissionError(
        request,
        user.id,
        id,
        error,
      );
      if (response) {
        return response;
      }
      throw error;
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;

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
      const payload = await updateCustomerCollaborators(
        db,
        user,
        customer,
        body,
      );
      return Response.json({
        ok: true,
        owner: payload.owner,
        collaborators: payload.collaborators,
        assignees: payload.assignees,
      });
    } catch (error) {
      const permissionResponse = await handleAssigneesPermissionError(
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
        return assigneesErrorResponse(error as AssigneesApiError);
      }

      throw error;
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}
