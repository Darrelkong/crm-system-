export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getRequestMeta } from "@/lib/auth/cookies";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import { getActiveCustomerTagKeys } from "@/lib/customer-tags/queries";
import { duplicateCustomerNameConflictResponse } from "@/lib/customers/name-duplicate-check";
import {
  FamilyLinkError,
  familyErrorResponse,
} from "@/lib/customers/households/errors";
import { createFamilyMemberCustomer } from "@/lib/customers/households/family-create-new";
import { PermissionError } from "@/lib/permissions/customers";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id: sourceCustomerId } = await context.params;
    const { ipAddress, userAgent } = getRequestMeta(request);

    const source = await getCustomerById(sourceCustomerId);
    if (!source) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const db = getDb();
    const allowedSourceKeys = await getActiveCustomerTagKeys(db);

    try {
      const outcome = await createFamilyMemberCustomer({
        db,
        source,
        actor: user,
        body,
        allowedSourceKeys,
        audit: { ipAddress, userAgent },
      });

      if ("kind" in outcome) {
        if (outcome.kind === "validation") {
          return Response.json(
            {
              error: "输入校验失败",
              errorCode: "VALIDATION_FAILED",
              fieldErrors: outcome.fieldErrors,
            },
            { status: 400 },
          );
        }

        if (outcome.kind === "internal_error") {
          return Response.json(
            {
              error: "服务器错误，请稍后重试",
              errorCode: "INTERNAL_ERROR",
            },
            { status: 500 },
          );
        }

        if (outcome.kind === "duplicate") {
          return Response.json(
            {
              error: "存在重复客户",
              errorCode: "DUPLICATE_CUSTOMER",
              code: "duplicate_customer",
              duplicate: true,
              duplicates: outcome.duplicates,
            },
            { status: 409 },
          );
        }

        if (outcome.kind === "name_duplicate") {
          return duplicateCustomerNameConflictResponse({
            normalizedName: outcome.normalizedName,
            duplicates: outcome.duplicates as Parameters<
              typeof duplicateCustomerNameConflictResponse
            >[0]["duplicates"],
          });
        }
      }

      if ("pendingApproval" in outcome && outcome.pendingApproval) {
        return Response.json(outcome, { status: 201 });
      }

      return Response.json(outcome, { status: 201 });
    } catch (error) {
      if (error instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: error.auditAction ?? "permission.denied.customer_family_manage",
          userId: user.id,
          entityType: "customer",
          entityId: sourceCustomerId,
        });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof FamilyLinkError) {
      return familyErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}
