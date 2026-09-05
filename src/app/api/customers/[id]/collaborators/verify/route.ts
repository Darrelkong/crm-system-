export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import { verifyCustomerCollaboratorEmail } from "@/lib/customers/collaborator-verification";
import { PermissionError } from "@/lib/permissions/customers";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_AVAILABLE_RESPONSE = { ok: false as const };

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

    const db = getDb();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(NOT_AVAILABLE_RESPONSE);
    }

    const email =
      body && typeof body === "object" && "email" in body
        ? (body as { email?: unknown }).email
        : undefined;
    const verified = await verifyCustomerCollaboratorEmail(db, {
      actor,
      customer,
      email,
    });

    if (!verified) {
      return Response.json(NOT_AVAILABLE_RESPONSE);
    }

    return Response.json({
      ok: true,
      user: verified,
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return Response.json(
        { error: error.message, errorCode: "CUSTOMER_COLLABORATORS_FORBIDDEN" },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
