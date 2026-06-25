export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { changeUserPassword } from "@/lib/auth/change-password";
import { getRequestMeta } from "@/lib/auth/cookies";

type ChangePasswordBody = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request, { allowMustChangePassword: true });
    const body = (await request.json()) as ChangePasswordBody;
    const { ipAddress, userAgent } = getRequestMeta(request);

    const fieldErrors = await changeUserPassword(
      user,
      {
        currentPassword: body.currentPassword ?? "",
        newPassword: body.newPassword ?? "",
        confirmPassword: body.confirmPassword ?? "",
      },
      { ipAddress, userAgent },
    );

    if (fieldErrors.length > 0) {
      return Response.json(
        {
          error: "输入校验失败",
          errorCode: "VALIDATION_FAILED",
          fieldErrors,
        },
        { status: 400 },
      );
    }

    return Response.json({
      ok: true,
      redirect: "/login?password_changed=1",
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
