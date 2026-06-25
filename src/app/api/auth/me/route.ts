import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth(undefined, { allowMustChangePassword: true });
    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        mustChangePassword: user.mustChangePassword === 1,
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
