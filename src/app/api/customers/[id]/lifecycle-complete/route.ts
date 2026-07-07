export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { getCustomerById } from "@/lib/customers/queries";
import {
  LifecycleCompleteError,
  completeCustomerLifecycle,
} from "@/lib/customers/lifecycle-complete";
import { getDb } from "@/lib/db";
import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireAdmin(request);
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
      notes?: unknown;
    };
    const notes = typeof body.notes === "string" ? body.notes : undefined;

    const db = getDb();
    const result = await completeCustomerLifecycle(db, {
      customer,
      actor,
      notes,
      ipAddress,
      userAgent,
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof LifecycleCompleteError) {
      return Response.json(
        { error: error.message, errorCode: error.code },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
