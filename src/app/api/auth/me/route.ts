import {
  getSessionTokenFromCookies,
  validateSessionToken,
} from "@/lib/auth/session";
import { buildAuthMeSuccessPayload } from "@/lib/auth/auth-me-response";
import { resolveAuthFromValidation } from "@/lib/auth/request-cache";
import { authErrorResponse } from "@/lib/permissions/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const token = await getSessionTokenFromCookies();
    const validation = token
      ? await validateSessionToken(token, { touch: true })
      : ({ ok: false, reason: "missing" } as const);

    if (!validation.ok) {
      // Maps access_reverify → SESSION_ACCESS_REVERIFY_REQUIRED (and other reasons).
      resolveAuthFromValidation(validation, { allowMustChangePassword: true });
      throw new Error("unreachable: resolveAuthFromValidation must throw");
    }

    return Response.json(buildAuthMeSuccessPayload(validation));
  } catch (error) {
    return authErrorResponse(error);
  }
}
