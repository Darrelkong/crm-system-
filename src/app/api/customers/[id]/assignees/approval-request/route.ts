export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireAuth(request);
    const { id } = await context.params;

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json(
        { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
        { status: 404 },
      );
    }

    return Response.json(
      {
        error: "协作成员调整已改为直接管理",
        errorCode: "ASSIGNEE_APPROVAL_DEPRECATED",
      },
      { status: 410 },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
