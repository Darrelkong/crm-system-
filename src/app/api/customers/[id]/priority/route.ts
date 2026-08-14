export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getRequestMeta } from "@/lib/auth/cookies";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";
import { PermissionError } from "@/lib/permissions/customers";
import {
  adminDirectRemovePriority,
  adminDirectSetPriority,
  createPriorityApprovalRequest,
  PriorityCustomerError,
} from "@/lib/customers/priority-customer-approval";
import type { PriorityRequestType } from "@/lib/customers/priority-customer";

type RouteContext = { params: Promise<{ id: string }> };

type PriorityActionBody = {
  action?: string;
  reason?: string;
};

export function priorityCustomerErrorResponse(error: unknown): Response {
  if (error instanceof PriorityCustomerError) {
    return Response.json(
      { error: error.message, errorCode: error.errorCode },
      { status: error.status },
    );
  }
  return authErrorResponse(error);
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

    const db = getDb();
    const pendingBlock = await blockPendingOnHoldCreateCustomer(db, id);
    if (pendingBlock) {
      return pendingBlock;
    }

    const body = (await request.json()) as PriorityActionBody;
    const action = body.action?.trim();
    if (action !== "set" && action !== "unset") {
      return Response.json(
        { error: "无效的操作", errorCode: "INVALID_PRIORITY_ACTION" },
        { status: 400 },
      );
    }

    const audit = { ipAddress, userAgent };

    if (user.role === "admin") {
      const result =
        action === "set"
          ? await adminDirectSetPriority(db, customer, user, audit)
          : await adminDirectRemovePriority(db, customer, user, audit);
      return Response.json({ ok: true, result });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return Response.json(
        {
          error: "申请原因必填",
          errorCode: "VALIDATION_FAILED",
          fieldErrors: [{ field: "reason", message: "申请原因必填" }],
        },
        { status: 400 },
      );
    }

    const requestType: PriorityRequestType =
      action === "set" ? "set_priority_customer" : "unset_priority_customer";

    try {
      const result = await createPriorityApprovalRequest(
        db,
        customer,
        user,
        requestType,
        reason,
        audit,
      );
      return Response.json({ ok: true, id: result.id, pending: true });
    } catch (error) {
      if (error instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: error.auditAction ?? "permission.denied.customer_edit",
          userId: user.id,
          entityType: "customer",
          entityId: id,
        });
      }
      throw error;
    }
  } catch (error) {
    return priorityCustomerErrorResponse(error);
  }
}
