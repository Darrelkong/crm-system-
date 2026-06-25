import { cookies } from "next/headers";
import {
  destroySession,
  getSessionByToken,
  getSessionTokenFromCookies,
} from "@/lib/auth/session";
import {
  getClearSessionCookieOptions,
  getRequestMeta,
} from "@/lib/auth/cookies";
import { ACCESS_LOGOUT_PATH } from "@/lib/auth/constants";
import { writeAuditLog } from "@/lib/audit/audit-log";

export const dynamic = "force-dynamic";

type LogoutBody = {
  reason?: "manual" | "idle";
};

export async function POST(request: Request) {
  const token = await getSessionTokenFromCookies();
  const { ipAddress, userAgent } = getRequestMeta(request);

  let body: LogoutBody = {};
  try {
    body = (await request.json()) as LogoutBody;
  } catch {
    body = {};
  }

  const reason = body.reason === "idle" ? "idle" : "manual";
  let userId: string | null = null;

  if (token) {
    const session = await getSessionByToken(token, { touch: false });
    userId = session?.user.id ?? null;
    await destroySession(token);
  }

  const cookieStore = await cookies();
  cookieStore.set({
    ...getClearSessionCookieOptions(),
    value: "",
  });

  if (userId) {
    await writeAuditLog({
      userId,
      action: reason === "idle" ? "auth.logout.idle" : "auth.logout",
      entityType: "session",
      entityId: userId,
      ipAddress,
      userAgent,
      metadata: { reason },
    });
  }

  return Response.json({
    ok: true,
    redirect: ACCESS_LOGOUT_PATH,
    reason,
  });
}
