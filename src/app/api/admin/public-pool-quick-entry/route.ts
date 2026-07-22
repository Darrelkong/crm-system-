export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import {
  authErrorResponse,
  requireAdmin,
} from "@/lib/permissions/auth";
import {
  getQuickEntryAdminState,
  QuickEntrySettingsError,
  setQuickEntryCode,
  setQuickEntryEnabled,
  type QuickEntryAdminState,
} from "@/lib/public-pool/quick-entry-settings";
import { QUICK_ENTRY_ERROR_CODES } from "@/lib/public-pool/quick-entry-constants";
import type { User } from "../../../../../drizzle/schema/users";

export type AdminQuickEntryRouteDeps = {
  requireAdmin: (request?: Request) => Promise<User>;
  getRequestMeta: (request: Request) => {
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  getQuickEntryAdminState: () => Promise<QuickEntryAdminState>;
  setQuickEntryCode: (
    actor: User,
    code: string,
    confirmCode: string,
    meta: { ipAddress?: string | null; userAgent?: string | null },
  ) => Promise<QuickEntryAdminState>;
  setQuickEntryEnabled: (
    actor: User,
    enabled: boolean,
    meta: { ipAddress?: string | null; userAgent?: string | null },
  ) => Promise<QuickEntryAdminState>;
};

const defaultDeps: AdminQuickEntryRouteDeps = {
  requireAdmin,
  getRequestMeta,
  getQuickEntryAdminState,
  setQuickEntryCode,
  setQuickEntryEnabled,
};

function adminStateResponse(state: QuickEntryAdminState, ok?: boolean) {
  return Response.json({
    ...(ok ? { ok: true } : {}),
    enabled: state.enabled,
    hasCode: state.hasCode,
    codeUpdatedAt: state.codeUpdatedAt,
    updatedBy: state.updatedBy,
  });
}

export async function handleAdminQuickEntryGet(
  request: Request,
  deps: AdminQuickEntryRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    await deps.requireAdmin(request);
    const state = await deps.getQuickEntryAdminState();
    return adminStateResponse(state);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function handleAdminQuickEntryPost(
  request: Request,
  deps: AdminQuickEntryRouteDeps = defaultDeps,
): Promise<Response> {
  try {
    const actor = await deps.requireAdmin(request);
    const { ipAddress, userAgent } = deps.getRequestMeta(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        {
          error: "请求无效",
          errorCode: QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR,
        },
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        {
          error: "请求无效",
          errorCode: QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR,
        },
        { status: 400 },
      );
    }

    const record = body as Record<string, unknown>;
    const action = record.action;

    if (action === "set_code") {
      const code = record.code;
      const confirmCode = record.confirmCode;
      if (typeof code !== "string" || typeof confirmCode !== "string") {
        return Response.json(
          {
            error: "请求无效",
            errorCode: QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR,
          },
          { status: 400 },
        );
      }

      const state = await deps.setQuickEntryCode(actor, code, confirmCode, {
        ipAddress,
        userAgent,
      });
      return adminStateResponse(state, true);
    }

    if (action === "set_enabled") {
      if (typeof record.enabled !== "boolean") {
        return Response.json(
          {
            error: "enabled 必须为 boolean",
            errorCode: QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR,
          },
          { status: 400 },
        );
      }

      const state = await deps.setQuickEntryEnabled(actor, record.enabled, {
        ipAddress,
        userAgent,
      });
      return adminStateResponse(state, true);
    }

    return Response.json(
      {
        error: "不支援的操作，action 必須為 set_code 或 set_enabled",
        errorCode: QUICK_ENTRY_ERROR_CODES.VALIDATION_ERROR,
      },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof QuickEntrySettingsError) {
      return Response.json(
        { error: error.message, errorCode: error.errorCode },
        { status: error.httpStatus },
      );
    }
    return authErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleAdminQuickEntryGet(request);
}

export async function POST(request: Request) {
  return handleAdminQuickEntryPost(request);
}
