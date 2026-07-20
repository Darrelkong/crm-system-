import { getRequestMeta } from "@/lib/auth/cookies";
import { authErrorResponse } from "@/lib/permissions/auth";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import {
  getGlobalIdlePolicy,
  updateGlobalIdleTimeoutExemption,
} from "@/lib/settings/global-idle-exemption";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireUserManagementAdmin(request);
    const policy = await getGlobalIdlePolicy();
    return Response.json({
      enabled: policy.globalIdleTimeoutExempt,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireUserManagementAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as {
      enabled?: unknown;
      staffAccessReverifyAfter?: unknown;
    };

    if ("staffAccessReverifyAfter" in body) {
      return Response.json(
        { error: "staffAccessReverifyAfter 不可由客户端提交" },
        { status: 400 },
      );
    }

    if (typeof body.enabled !== "boolean") {
      return Response.json(
        { error: "enabled 必须为 boolean" },
        { status: 400 },
      );
    }

    const result = await updateGlobalIdleTimeoutExemption(actor, body.enabled, {
      ipAddress,
      userAgent,
    });

    return Response.json({
      enabled: result.enabled,
      changed: result.changed,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
