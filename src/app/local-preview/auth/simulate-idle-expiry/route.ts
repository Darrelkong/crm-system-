import { cookies } from "next/headers";
import {
  destroySession,
  getSessionTokenFromCookies,
} from "@/lib/auth/session";
import { getClearSessionCookieOptions } from "@/lib/auth/cookies";
import { isLocalAuthSimulationEnabled } from "@/lib/auth/local-preview-auth-simulation";

export const dynamic = "force-dynamic";

/**
 * Local-preview-only human test hook.
 * It expires only the current CRM session and never calls Access logout.
 */
export async function POST(): Promise<Response> {
  if (!isLocalAuthSimulationEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const token = await getSessionTokenFromCookies();
  if (token) {
    await destroySession(token);
  }

  const cookieStore = await cookies();
  cookieStore.set({
    ...getClearSessionCookieOptions(),
    value: "",
  });

  return new Response(null, {
    status: 303,
    headers: { Location: "/login?reason=timeout" },
  });
}
