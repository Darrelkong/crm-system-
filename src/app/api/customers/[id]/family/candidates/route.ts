export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import {
  FamilyLinkError,
  familyErrorResponse,
} from "@/lib/customers/households/errors";
import { assertCanManageCustomerFamily } from "@/lib/customers/households/family-permissions";
import { searchFamilyCandidates } from "@/lib/customers/households/family-candidates";
import { PermissionError } from "@/lib/permissions/customers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";

    const source = await getCustomerById(id);
    if (!source) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    try {
      assertCanManageCustomerFamily(user, source);
    } catch (error) {
      if (error instanceof FamilyLinkError) {
        return familyErrorResponse(error);
      }
      if (error instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: error.auditAction ?? "permission.denied.customer_family_manage",
          userId: user.id,
          entityType: "customer",
          entityId: id,
        });
        return Response.json(
          { error: error.message, errorCode: "FAMILY_SOURCE_NOT_ELIGIBLE" },
          { status: error.status },
        );
      }
      throw error;
    }

    const db = getDb();
    const candidates = await searchFamilyCandidates(db, user, source, q);
    return Response.json({ candidates });
  } catch (error) {
    if (error instanceof FamilyLinkError) {
      return familyErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}
