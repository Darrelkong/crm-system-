import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
