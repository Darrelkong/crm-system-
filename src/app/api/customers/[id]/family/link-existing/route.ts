export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getRequestMeta } from "@/lib/auth/cookies";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import {
  FamilyLinkError,
  familyErrorResponse,
} from "@/lib/customers/households/errors";
import { PermissionError } from "@/lib/permissions/customers";
import {
  submitFamilyLinkRequest,
  type FamilyLinkRequestBody,
} from "@/lib/customers/households/family-link-approval";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const { ipAddress, userAgent } = getRequestMeta(request);

    const source = await getCustomerById(id);
    if (!source) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const body = (await request.json()) as FamilyLinkRequestBody;
    const db = getDb();

    try {
      const result = await submitFamilyLinkRequest(db, source, user, body, {
        ipAddress,
        userAgent,
      });
      return Response.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: error.auditAction ?? "permission.denied.customer_family_manage",
          userId: user.id,
          entityType: "customer",
          entityId: id,
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
