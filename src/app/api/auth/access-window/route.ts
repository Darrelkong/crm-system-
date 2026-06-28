import { NextResponse } from "next/server";
import { AUTH_ERROR_CODES } from "@/lib/auth/constants";
import {
  applyIdleReloginCookieUpdateToResponse,
  resolveIdleReloginStateFromRequest,
} from "@/lib/auth/idle-relogin-cookie";
import {
  isAccessJwtCheckSkipped,
  validateAccessLoginWindowFromRequest,
} from "@/lib/auth/access-jwt";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (isAccessJwtCheckSkipped(request.headers)) {
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  const accessWindow = validateAccessLoginWindowFromRequest(request);
  if (!accessWindow.ok) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: AUTH_ERROR_CODES.ACCESS_VERIFICATION_EXPIRED,
      },
      { status: 401, headers: NO_STORE },
    );
  }

  const state = resolveIdleReloginStateFromRequest(request);

  const response = state.requiresAccessReverify
    ? NextResponse.json(
        {
          ok: false,
          errorCode: AUTH_ERROR_CODES.ACCESS_VERIFICATION_EXPIRED,
        },
        { status: 403, headers: NO_STORE },
      )
    : NextResponse.json({ ok: true }, { headers: NO_STORE });

  if (state.cookieUpdate) {
    applyIdleReloginCookieUpdateToResponse(response, state.cookieUpdate);
  }

  return response;
}
