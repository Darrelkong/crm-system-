export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  authErrorResponse,
  requireAuthSession,
  type AuthSessionContext,
} from "@/lib/public-pool/quick-entry-auth";
import {
  QuickEntrySecurityError,
  verifyQuickEntryCode,
  type QuickEntryVerifySuccess,
} from "@/lib/public-pool/quick-entry-security";
import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";
import type { User } from "../../../../../../drizzle/schema/users";

export type QuickEntryVerifyRouteDeps = {
  requireAuthSession: () => Promise<AuthSessionContext>;
  getRequestMeta: (request: Request) => {
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  verifyQuickEntryCode: (input: {
    user: User;
    sessionId: string;
    code: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) => Promise<QuickEntryVerifySuccess>;
};

const defaultDeps: QuickEntryVerifyRouteDeps = {
  requireAuthSession,
  getRequestMeta,
  verifyQuickEntryCode,
};

export async function handleQuickEntryVerifyPost(
  request: Request,
  deps: QuickEntryVerifyRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const { user, sessionId } = await deps.requireAuthSession();
    const { ipAddress, userAgent } = deps.getRequestMeta(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        {
          ok: false,
          error: "请求无效",
          errorCode: QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR,
        },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        {
          ok: false,
          error: "请求无效",
          errorCode: QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR,
        },
        { status: 400 },
      );
    }

    const record = body as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some((key) => key !== "code")) {
      return Response.json(
        {
          ok: false,
          error: "请求无效",
          errorCode: QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR,
        },
        { status: 400 },
      );
    }

    const result = await deps.verifyQuickEntryCode({
      user,
      sessionId,
      code: record.code,
      ipAddress,
      userAgent,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof QuickEntrySecurityError) {
      const headers = new Headers();
      if (
        error.httpStatus === 429 &&
        error.retryAfterSeconds != null
      ) {
        headers.set("Retry-After", String(error.retryAfterSeconds));
      }
      return Response.json(
        {
          ok: false,
          error: error.message,
          errorCode: error.errorCode,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: error.httpStatus, headers },
      );
    }
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  return handleQuickEntryVerifyPost(request);
}
