export const dynamic = "force-dynamic";

import {
  requireAuth,
  authErrorResponse,
  getCustomerAccessLevel,
} from "@/lib/permissions";
import {
  assertDebugApiEnabled,
  debugDisabledResponse,
} from "@/lib/debug/guard";

export async function GET(request: Request) {
  try {
    assertDebugApiEnabled();
    const user = await requireAuth(request);

    return Response.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("disabled")) {
      return debugDisabledResponse();
    }
    return authErrorResponse(error);
  }
}
