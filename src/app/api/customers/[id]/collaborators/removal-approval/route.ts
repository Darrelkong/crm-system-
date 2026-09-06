export const dynamic = "force-dynamic";

import { and, eq } from "drizzle-orm";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb, schema } from "@/lib/db";
import { createApprovalRequest, ApprovalError } from "@/lib/approvals/service";
import { assertCanRequestCustomerCollaboratorRemoval, PermissionError } from "@/lib/permissions/customers";
import { assertCustomerCollaboratorsMutable } from "@/lib/customers/assignees-mutations";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireAuth(request);
    const { id } = await context.params;
    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    assertCanRequestCustomerCollaboratorRemoval(actor, customer);
    const db = getDb();
    await assertCustomerCollaboratorsMutable(db, id);
    const body = (await request.json()) as Record<string, unknown>;
    const collaboratorUserId =
      typeof body.userId === "string" ? body.userId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!collaboratorUserId || !reason) {
      return Response.json(
        { error: "协作成员和申请原因必填", errorCode: "INVALID_REQUEST" },
        { status: 400 },
      );
    }

    const relationship = await db
      .select({ id: schema.customerAssignees.id })
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.customerId, id),
          eq(schema.customerAssignees.userId, collaboratorUserId),
          eq(schema.customerAssignees.role, "collaborator"),
        ),
      )
      .limit(1);
    if (relationship.length === 0) {
      return Response.json(
        { error: "该员工不是此客户的协作成员", errorCode: "COLLABORATOR_NOT_FOUND" },
        { status: 400 },
      );
    }

    const approval = await createApprovalRequest(customer, actor, {
      requestType: "remove_customer_collaborator",
      targetUserId: collaboratorUserId,
      reason,
    });
    return Response.json({ ok: true, pending: true, approvalId: approval.id });
  } catch (error) {
    if (error instanceof PermissionError) {
      return Response.json(
        {
          error: error.message,
          errorCode: error.auditAction ?? "INSUFFICIENT_PERMISSIONS",
        },
        { status: error.status },
      );
    }
    if (error instanceof ApprovalError) {
      return Response.json(
        { error: error.message, errorCode: error.code ?? "APPROVAL_ERROR" },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
