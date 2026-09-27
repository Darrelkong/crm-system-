import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { correctCustomerRating } from "@/lib/customers/rating/correction-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    return await correctCustomerRating(request, (await context.params).id, user);
  } catch (error) {
    return authErrorResponse(error);
  }
}
