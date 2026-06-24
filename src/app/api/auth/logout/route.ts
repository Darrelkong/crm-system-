import { cookies } from "next/headers";
import {
  destroySession,
  getSessionTokenFromCookies,
} from "@/lib/auth/session";
import {
  getClearSessionCookieOptions,
  getRequestMeta,
} from "@/lib/auth/cookies";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { writeAuditLog } from "@/lib/audit/audit-log";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const token = await getSessionTokenFromCookies();
    const { ipAddress, userAgent } = getRequestMeta(request);

    if (token) {
      await destroySession(token);
    }

    const cookieStore = await cookies();
    cookieStore.set({
      ...getClearSessionCookieOptions(),
      value: "",
    });

    await writeAuditLog({
      userId: user.id,
      action: "auth.logout",
      entityType: "session",
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return Response.json({ ok: true, redirect: "/login" });
  } catch (error) {
    return authErrorResponse(error);
  }
}
