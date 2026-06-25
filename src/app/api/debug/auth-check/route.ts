export const dynamic = "force-dynamic";

import { authErrorResponse } from "@/lib/permissions";
import {
  debugDisabledResponse,
  requireDebugApiAdmin,
} from "@/lib/debug/guard";

export async function GET(request: Request) {
  try {
    const user = await requireDebugApiAdmin(request);

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
