export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { getCustomerById } from "@/lib/customers/queries";
import {
  ConfirmNameError,
  confirmCustomerName,
} from "@/lib/customers/confirm-name";
import { getDb } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireAuth(request);
    const { id } = await context.params;
    const { ipAddress, userAgent } = getRequestMeta(request);

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      customerName?: unknown;
    };

    const db = getDb();
    const result = await confirmCustomerName(db, {
      customer,
      actor,
      customerName: body.customerName,
      ipAddress,
      userAgent,
    });

    return Response.json({
      ok: true,
      customer: {
        id: result.id,
        customerName: result.customerName,
        nameStatus: result.nameStatus,
      },
    });
  } catch (error) {
    if (error instanceof ConfirmNameError) {
      return Response.json(
        { error: error.message, errorCode: error.code },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
